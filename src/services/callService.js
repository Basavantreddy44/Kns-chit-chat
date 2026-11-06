import { AuthError } from './AuthError';
import { rpc } from './employeeService';
import { getSupabase, getSupabaseSettings } from './supabaseClient';

/**
 * Calls. These functions manage who is calling whom; audio travels directly between
 * the two browsers (see callPeer.js) and is never stored.
 * See supabase/migrations/20261106100000_calls.sql.
 */

const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const ICE_LOOKUP_TIMEOUT_MS = 4000;

export const startCall = (employeeId, type, device) =>
  rpc('start_call', { p_employee: employeeId, p_type: type, p_device: device });

export const getMyActiveCall = async () => (await rpc('get_my_active_call'))?.[0] ?? null;
export const markCallRinging = (callId) => rpc('mark_call_ringing', { p_call: callId });
export const answerCall = (callId, device) => rpc('answer_call', { p_call: callId, p_device: device });
export const rejectCall = (callId) => rpc('reject_call', { p_call: callId });
export const endCall = (callId, reason = 'hung_up') => rpc('end_call', { p_call: callId, p_reason: reason });
export const markCallConnected = (callId) => rpc('mark_call_connected', { p_call: callId });
export const sendCallHeartbeat = (callId) => rpc('call_heartbeat', { p_call: callId });

/**
 * Ends the call while the page is closing, when ordinary requests get cancelled.
 * Best effort: if it doesn't arrive, the other side notices the connection has gone.
 */
export function endCallWhileClosing(callId, accessToken) {
  const { url, key } = getSupabaseSettings();
  fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/end_call`, {
    method: 'POST',
    keepalive: true,
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_call: callId, p_reason: 'page_closed' }),
  }).catch(() => {});
}

export async function getAccessToken() {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Connection helpers for this call. If relay credentials aren't available, the call
 * still tries with STUN alone, which works on most networks.
 */
export async function getIceServers() {
  try {
    const lookup = getSupabase().functions.invoke('get-ice-servers', { method: 'POST' });
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve({ data: null }), ICE_LOOKUP_TIMEOUT_MS);
    });
    const { data } = await Promise.race([lookup, timeout]);
    if (data?.iceServers?.length) return data.iceServers;
  } catch {
    // Fall through to STUN alone.
  }
  return FALLBACK_ICE_SERVERS;
}

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const CAMERA_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

function requireMediaDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new AuthError(
      'This browser can’t make calls here. Calls need a secure (HTTPS) connection and a modern browser.',
      'VALIDATION_ERROR',
    );
  }
}

function microphoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new AuthError(
      'Microphone access is blocked. Allow it in your browser’s site settings and try again.',
      'VALIDATION_ERROR',
    );
  }
  if (error?.name === 'NotFoundError') {
    return new AuthError('No microphone was found. Connect one and try again.', 'VALIDATION_ERROR');
  }
  return new AuthError('The microphone couldn’t be started. It may be in use by another app.', 'VALIDATION_ERROR');
}

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new AuthError('Camera access is blocked. Allow it in your browser’s site settings.', 'VALIDATION_ERROR');
  }
  if (error?.name === 'NotFoundError') return new AuthError('No camera was found.', 'VALIDATION_ERROR');
  return new AuthError('The camera couldn’t be started. It may be in use by another app.', 'VALIDATION_ERROR');
}

/**
 * Asks for what a call needs. The microphone is essential. A camera that can't start
 * shouldn't stop a video call going ahead, so that person joins by audio and is told why.
 */
export async function requestCallMedia(callType) {
  requireMediaDevices();

  let audioStream;
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (error) {
    throw microphoneError(error);
  }
  const audioTrack = audioStream.getAudioTracks()[0];
  if (callType !== 'video') return { audioTrack, cameraTrack: null, notice: '' };

  try {
    return { audioTrack, cameraTrack: await requestCamera(), notice: '' };
  } catch (error) {
    return { audioTrack, cameraTrack: null, notice: `${error.message} You’ve joined with audio only.` };
  }
}

export async function requestCamera() {
  requireMediaDevices();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS });
    return stream.getVideoTracks()[0];
  } catch (error) {
    throw cameraError(error);
  }
}

/** Phone browsers define the screen-sharing call but can't actually do it. */
export function canShareScreen() {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false;
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Opens the browser's own screen picker. Nothing is captured without the person
 * choosing here. Returns null if they cancel, which isn't an error.
 */
export async function requestScreen() {
  if (!canShareScreen()) {
    throw new AuthError('Screen sharing isn’t supported in this browser.', 'VALIDATION_ERROR');
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    // Keeps text readable rather than favouring smooth motion.
    if (track && 'contentHint' in track) track.contentHint = 'detail';
    return track;
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'NotAllowedError') return null;
    throw new AuthError('Your screen couldn’t be shared. Please try again.', 'VALIDATION_ERROR');
  }
}
