import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { AUTH_MODE } from '../services/authService';
import { CallPeer } from '../services/callPeer';
import {
  answerCall,
  canShareScreen,
  endCall,
  endCallWhileClosing,
  getAccessToken,
  getIceServers,
  getMyActiveCall,
  markCallConnected,
  markCallRinging,
  rejectCall,
  requestCallMedia,
  requestCamera,
  requestScreen,
  sendCallHeartbeat,
  startCall,
} from '../services/callService';
import { getEmployee } from '../services/employeeService';
import { getSupabase } from '../services/supabaseClient';
import { playCallTone } from '../utils/callTones';

/**
 * Everything about the current call, available across the workspace so a call carries
 * on while someone moves between pages.
 *
 * phase: idle | calling | ringing | connecting | connected | reconnecting | ended
 * `incoming` is separate: someone is calling this person right now.
 */
const CallContext = createContext(null);

const NO_RESPONSE_MS = 8000; // their app hasn't confirmed it's ringing: they're not there
const NO_ANSWER_MS = 45000;
const INCOMING_EXPIRES_MS = 50000;
const HEARTBEAT_MS = 15000;
const ENDED_NOTICE_MS = 3500;
const OPEN_CALL_KEY = 'kns.call.open'; // per tab: lets a refreshed tab end what it left behind

const IDLE = {
  phase: 'idle',
  employee: null,
  callType: 'audio',
  isMuted: false,
  isCameraOn: false,
  isSharing: false,
  localCamera: null,
  remoteCamera: null,
  remoteScreen: null,
  remoteMuted: false,
  remoteCameraOn: false,
  remoteSharing: false,
  isMinimized: false,
  connectedAt: null,
  notice: '',
  mediaNotice: '',
};

function rememberOpenCall(id) {
  try {
    if (id) sessionStorage.setItem(OPEN_CALL_KEY, id);
    else sessionStorage.removeItem(OPEN_CALL_KEY);
  } catch {
    // Storage blocked: the heartbeat still clears the call in time.
  }
}

function recallOpenCall() {
  try {
    return sessionStorage.getItem(OPEN_CALL_KEY);
  } catch {
    return null;
  }
}

async function employeeOrFallback(id) {
  const employee = await getEmployee(id).catch(() => null);
  return employee ?? { id, full_name: 'A colleague' };
}

function noticeFor(row, name) {
  switch (row.status) {
    case 'rejected':
      return `${name} declined the call.`;
    case 'missed':
      return row.end_reason === 'unreachable' ? `${name} isn’t available right now.` : `${name} didn’t answer.`;
    case 'cancelled':
      return 'The call was cancelled.';
    default:
      return row.end_reason === 'connection_lost' ? 'The connection was lost.' : 'Call ended.';
  }
}

export function CallProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [state, setState] = useState(IDLE);
  const [incoming, setIncoming] = useState(null);
  const remoteAudioRef = useRef(null);
  const deviceId = useRef(crypto.randomUUID());
  const ignoredCalls = useRef(new Set());

  // The call in progress in this tab. Kept outside state because event handlers read it.
  // { id, isCaller, employee, audioTrack, cameraTrack, screenTrack, peer, token, timers }
  const active = useRef(null);
  const incomingRef = useRef(null);
  incomingRef.current = incoming;
  const handlers = useRef({});

  const patch = useCallback((changes) => setState((current) => ({ ...current, ...changes })), []);

  const release = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    current.timers.forEach((timer) => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    current.peer?.close();
    // Stopping these is what turns off the camera light and the sharing indicator.
    [current.audioTrack, current.cameraTrack, current.screenTrack].forEach((track) => {
      if (track) {
        track.onended = null;
        track.stop();
      }
    });
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    rememberOpenCall(null);
  }, []);

  const showEnded = useCallback(
    (notice) => {
      release();
      setState({ ...IDLE, phase: 'ended', notice });
      setTimeout(() => {
        setState((current) => (current.phase === 'ended' ? IDLE : current));
      }, ENDED_NOTICE_MS);
    },
    [release],
  );

  const hangUp = useCallback(
    async (reason, notice) => {
      const current = active.current;
      if (!current) return;
      showEnded(notice);
      await endCall(current.id, reason).catch(() => {});
    },
    [showEnded],
  );

  /** Tells the other side what we're sending, so their screen matches. */
  const shareMediaState = useCallback((current) => {
    current.peer?.sendMediaState({
      muted: !current.audioTrack?.enabled,
      cameraOn: Boolean(current.cameraTrack),
      sharing: Boolean(current.screenTrack),
    });
  }, []);

  const beginConnecting = useCallback(async () => {
    const current = active.current;
    // Answering and the "answered" event both arrive here. Only one may connect.
    if (!current || current.hasStartedConnecting) return;
    current.hasStartedConnecting = true;
    patch({ phase: 'connecting' });

    const iceServers = await getIceServers();
    if (active.current !== current) return;

    current.peer = new CallPeer({
      callId: current.id,
      isCaller: current.isCaller,
      iceServers,
      localTracks: { audio: current.audioTrack, camera: current.cameraTrack, screen: current.screenTrack },
      onRemoteTracks: ({ audio, camera, screen }) => {
        if (active.current !== current) return;
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = new MediaStream([audio]);
          remoteAudioRef.current.play?.().catch(() => {});
        }
        patch({ remoteCamera: camera, remoteScreen: screen });
      },
      onStatus: (status) => {
        if (active.current !== current) return;
        if (status === 'connected') {
          setState((previous) => ({
            ...previous,
            phase: 'connected',
            connectedAt: previous.connectedAt ?? Date.now(),
          }));
          markCallConnected(current.id).catch(() => {});
          shareMediaState(current);
        } else {
          patch({ phase: status });
        }
      },
      onRemoteMedia: ({ muted, cameraOn, sharing }) => {
        if (active.current !== current) return;
        setState((previous) => ({
          ...previous,
          remoteMuted: Boolean(muted),
          remoteCameraOn: Boolean(cameraOn),
          remoteSharing: Boolean(sharing),
          // A screen someone has just started sharing should be seen straight away.
          isMinimized: sharing && !previous.remoteSharing ? false : previous.isMinimized,
        }));
      },
      onLost: (hadConnected) =>
        hangUp(hadConnected ? 'connection_lost' : 'connection_failed', hadConnected ? 'The connection was lost.' : 'The call couldn’t connect.'),
    });

    const heartbeat = () => {
      sendCallHeartbeat(current.id)
        .then((isLive) => {
          if (isLive === false && active.current === current) showEnded('Call ended.');
        })
        .catch(() => {});
      // Repeated, in case an earlier update was lost.
      if (current.peer?.peerIsReady) shareMediaState(current);
    };
    heartbeat();
    current.timers.push(setInterval(heartbeat, HEARTBEAT_MS));
  }, [hangUp, patch, shareMediaState, showEnded]);

  /** Every change to one of this person's calls comes through here. */
  const handleRow = useCallback(
    async (row) => {
      const isOver = Boolean(row.ended_at);
      const amCallee = row.callee_id === userId;
      const current = active.current;

      if (incomingRef.current?.call.id === row.id) {
        const answeredElsewhere = row.status === 'accepted' && row.answered_device !== deviceId.current;
        if (isOver || answeredElsewhere) setIncoming(null);
      }

      if (current?.id === row.id) {
        if (isOver) {
          showEnded(noticeFor(row, current.employee.full_name));
        } else if (row.status === 'ringing' && current.isCaller) {
          setState((previous) => (previous.phase === 'calling' ? { ...previous, phase: 'ringing' } : previous));
        } else if (row.status === 'accepted' || row.status === 'connected') {
          beginConnecting();
        }
        return;
      }

      if (isOver || !amCallee || current) return;
      if (row.status !== 'calling' && row.status !== 'ringing') return;
      if (ignoredCalls.current.has(row.id) || incomingRef.current?.call.id === row.id) return;

      // Reserve the slot straight away, so a second event doesn't ring twice.
      const placeholder = { call: row, employee: { id: row.caller_id, full_name: 'Incoming call' }, error: '', isAnswering: false };
      incomingRef.current = placeholder;
      setIncoming(placeholder);
      markCallRinging(row.id).catch(() => {});
      const employee = await employeeOrFallback(row.caller_id);
      setIncoming((value) => (value?.call.id === row.id ? { ...value, employee } : value));
    },
    [beginConnecting, showEnded, userId],
  );
  handlers.current.handleRow = handleRow;

  /** Catches up after a reconnect, a refresh or returning to the tab. */
  const reconcile = useCallback(async () => {
    let call;
    try {
      call = await getMyActiveCall();
    } catch {
      return; // Calling isn't available, or we're offline: try again next time.
    }

    const current = active.current;
    if (current && call?.id !== current.id) {
      showEnded('Call ended.');
      return;
    }
    if (!call) return;

    // This tab was in the call and was refreshed: the connection is gone for good.
    if (!current && recallOpenCall() === call.id) {
      rememberOpenCall(null);
      await endCall(call.id, 'page_closed').catch(() => {});
      return;
    }

    handlers.current.handleRow(call);
  }, [showEnded]);

  useEffect(() => {
    if (AUTH_MODE !== 'supabase' || !userId) return undefined;

    const supabase = getSupabase();
    let channel = null;
    let isCancelled = false;

    // As elsewhere: joining before the saved session is restored would join anonymously.
    supabase.realtime
      .setAuth()
      .catch(() => {})
      .then(() => {
        if (isCancelled) return;
        channel = supabase
          .channel(`calls:${userId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, (payload) => {
            if (payload.new?.id) handlers.current.handleRow(payload.new);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') reconcile();
          });
      });

    window.addEventListener('focus', reconcile);

    const handleClosing = () => {
      const current = active.current;
      if (current?.token) endCallWhileClosing(current.id, current.token);
    };
    window.addEventListener('pagehide', handleClosing);

    return () => {
      isCancelled = true;
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('pagehide', handleClosing);
      if (channel) supabase.removeChannel(channel);
      // Leaving the workspace, such as logging out, ends any call.
      const current = active.current;
      if (current) endCall(current.id, 'hung_up').catch(() => {});
      release();
    };
  }, [userId, reconcile, release]);

  // Ringing stops by itself in case the caller's browser vanished without saying so.
  useEffect(() => {
    if (!incoming) return undefined;
    const stopTone = playCallTone('incoming');
    const timer = setTimeout(() => setIncoming(null), INCOMING_EXPIRES_MS);
    return () => {
      stopTone();
      clearTimeout(timer);
    };
  }, [incoming?.call.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.phase !== 'ringing') return undefined;
    return playCallTone('outgoing');
  }, [state.phase]);

  const stopMediaTracks = ({ audioTrack, cameraTrack }) => {
    audioTrack?.stop();
    cameraTrack?.stop();
  };

  const start = useCallback(
    async (employee, type = 'audio') => {
      if (active.current || incomingRef.current) {
        throw new Error('Finish your current call first.');
      }
      // Devices come first: no point ringing someone we can't talk to.
      const media = await requestCallMedia(type);

      let row;
      try {
        row = await startCall(employee.id, type, deviceId.current);
      } catch (error) {
        stopMediaTracks(media);
        throw error;
      }

      const current = {
        id: row.id,
        isCaller: row.caller_id === userId,
        employee,
        audioTrack: media.audioTrack,
        cameraTrack: media.cameraTrack,
        screenTrack: null,
        peer: null,
        token: await getAccessToken(),
        timers: [],
      };
      active.current = current;
      rememberOpenCall(row.id);
      setState({
        ...IDLE,
        phase: 'calling',
        employee,
        callType: row.call_type,
        isCameraOn: Boolean(media.cameraTrack),
        localCamera: media.cameraTrack,
        mediaNotice: media.notice,
      });

      // They were calling us at the same moment, so the two calls became one.
      if (row.status === 'accepted') {
        setIncoming(null);
        beginConnecting();
        return;
      }

      current.timers.push(
        setTimeout(async () => {
          if (active.current !== current || current.hasStartedConnecting) return;
          const fresh = await getMyActiveCall().catch(() => null);
          if (active.current !== current) return;
          if (!fresh || fresh.id !== current.id || fresh.status === 'calling') {
            hangUp('unreachable', `${employee.full_name} isn’t available right now.`);
          } else {
            handlers.current.handleRow(fresh);
          }
        }, NO_RESPONSE_MS),
      );
      current.timers.push(
        setTimeout(() => {
          if (active.current === current && !current.hasStartedConnecting) {
            hangUp('no_answer', `${employee.full_name} didn’t answer.`);
          }
        }, NO_ANSWER_MS),
      );
    },
    [beginConnecting, hangUp, userId],
  );

  const accept = useCallback(async () => {
    const offer = incomingRef.current;
    if (!offer || offer.isAnswering) return;
    setIncoming({ ...offer, isAnswering: true, error: '' });

    let media;
    try {
      media = await requestCallMedia(offer.call.call_type);
    } catch (error) {
      // Keep ringing, so they can fix the permission and try again.
      setIncoming((value) => (value?.call.id === offer.call.id ? { ...value, isAnswering: false, error: error.message } : value));
      return;
    }

    try {
      const row = await answerCall(offer.call.id, deviceId.current);
      active.current = {
        id: row.id,
        isCaller: false,
        employee: offer.employee,
        audioTrack: media.audioTrack,
        cameraTrack: media.cameraTrack,
        screenTrack: null,
        peer: null,
        token: await getAccessToken(),
        timers: [],
      };
      rememberOpenCall(row.id);
      setIncoming(null);
      setState({
        ...IDLE,
        phase: 'connecting',
        employee: offer.employee,
        callType: row.call_type,
        isCameraOn: Boolean(media.cameraTrack),
        localCamera: media.cameraTrack,
        mediaNotice: media.notice,
      });
      beginConnecting();
    } catch (error) {
      stopMediaTracks(media);
      setIncoming((value) => (value?.call.id === offer.call.id ? { ...value, isAnswering: false, error: error?.message || 'This call is no longer available.' } : value));
    }
  }, [beginConnecting]);

  const reject = useCallback(() => {
    const offer = incomingRef.current;
    if (!offer) return;
    setIncoming(null);
    rejectCall(offer.call.id).catch(() => {});
  }, []);

  // Stops ringing here only. The caller keeps ringing until the call times out.
  const ignore = useCallback(() => {
    const offer = incomingRef.current;
    if (!offer) return;
    ignoredCalls.current.add(offer.call.id);
    setIncoming(null);
  }, []);

  const end = useCallback(() => {
    const current = active.current;
    if (!current) return;
    hangUp('hung_up', current.hasStartedConnecting ? 'Call ended.' : 'Call cancelled.');
  }, [hangUp]);

  const toggleMute = useCallback(() => {
    const current = active.current;
    const track = current?.audioTrack;
    if (!track) return;
    track.enabled = !track.enabled;
    patch({ isMuted: !track.enabled });
    shareMediaState(current);
  }, [patch, shareMediaState]);

  const toggleCamera = useCallback(async () => {
    const current = active.current;
    if (!current || current.isSwitchingCamera) return;

    if (current.cameraTrack) {
      const track = current.cameraTrack;
      current.cameraTrack = null;
      track.stop(); // turns the camera light off, rather than only hiding the picture
      await current.peer?.setTrack('camera', null);
      patch({ isCameraOn: false, localCamera: null, mediaNotice: '' });
      shareMediaState(current);
      return;
    }

    current.isSwitchingCamera = true;
    try {
      const track = await requestCamera();
      if (active.current !== current) {
        track.stop();
        return;
      }
      current.cameraTrack = track;
      await current.peer?.setTrack('camera', track);
      patch({ isCameraOn: true, localCamera: track, isMinimized: false, mediaNotice: '' });
      shareMediaState(current);
    } catch (error) {
      patch({ mediaNotice: error?.message || 'The camera couldn’t be started.' });
    } finally {
      current.isSwitchingCamera = false;
    }
  }, [patch, shareMediaState]);

  const stopSharing = useCallback(async () => {
    const current = active.current;
    const track = current?.screenTrack;
    if (!track) return;
    current.screenTrack = null;
    track.onended = null;
    track.stop();
    await current.peer?.setTrack('screen', null);
    patch({ isSharing: false });
    shareMediaState(current);
  }, [patch, shareMediaState]);

  /** Only during a connected call, and only from a click, through the browser's own picker. */
  const startSharing = useCallback(async () => {
    const current = active.current;
    if (!current?.peer || current.screenTrack || current.isChoosingScreen) return;

    current.isChoosingScreen = true;
    patch({ mediaNotice: '' });
    try {
      const track = await requestScreen();
      if (!track) return; // they cancelled the picker, so the call simply carries on
      if (active.current !== current) {
        track.stop();
        return;
      }
      current.screenTrack = track;
      // The browser's own "Stop sharing" button ends the track directly.
      track.onended = () => {
        if (active.current === current && current.screenTrack === track) stopSharing();
      };
      await current.peer.setTrack('screen', track);
      patch({ isSharing: true });
      shareMediaState(current);
    } catch (error) {
      patch({ mediaNotice: error?.message || 'Your screen couldn’t be shared.' });
    } finally {
      current.isChoosingScreen = false;
    }
  }, [patch, shareMediaState, stopSharing]);

  const setMinimized = useCallback((isMinimized) => patch({ isMinimized }), [patch]);

  const value = useMemo(
    () => ({
      ...state,
      incoming,
      isBusy: state.phase !== 'idle' && state.phase !== 'ended',
      isLive: state.phase === 'connected' || state.phase === 'reconnecting',
      canShareScreen: canShareScreen(),
      remoteAudioRef,
      start,
      accept,
      reject,
      ignore,
      end,
      toggleMute,
      toggleCamera,
      startSharing,
      stopSharing,
      setMinimized,
    }),
    [state, incoming, start, accept, reject, ignore, end, toggleMute, toggleCamera, startSharing, stopSharing, setMinimized],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used inside <CallProvider>.');
  return context;
}
