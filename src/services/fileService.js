import { AuthError } from './AuthError';
import { rpc } from './employeeService';
import { getSupabase, getSupabaseSettings } from './supabaseClient';
import { mimeTypeFor } from '../config/fileTypes';

/**
 * Document sharing. Files are private: every link is short-lived and is only issued
 * after Supabase checks the caller's access to the conversation or channel.
 * See supabase/migrations/20261105150000_document_sharing.sql.
 */

const BUCKET = 'shared-files';
const SIGNED_URL_SECONDS = 60;
// An image in a chat stays on screen a while, but the link still expires.
const PREVIEW_URL_SECONDS = 300;

export const FILE_PAGE_SIZE = 30;

function uploadError(status, body) {
  const code = String(body?.statusCode ?? status);
  if (code === '413') return new AuthError('This file is larger than the 25 MB limit.', 'VALIDATION_ERROR', 413);
  if (code === '415') return new AuthError('This file type isn’t supported.', 'VALIDATION_ERROR', 415);
  if (code === '401' || code === '403' || status === 403) {
    return new AuthError('You don’t have permission to share files here.', 'VALIDATION_ERROR', 403);
  }
  return new AuthError('The upload failed. Please try again.', 'SERVER_ERROR', status);
}

/**
 * Stores a file, reporting progress from 0 to 1. The client library can't report
 * upload progress, so this speaks to the Storage API directly, as the signed-in user.
 */
export async function uploadFile(path, file, { onProgress, signal } = {}) {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AuthError('Your session has ended. Please log in again.', 'VALIDATION_ERROR', 401);

  const { url, key } = getSupabaseSettings();
  const target = `${url.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${path}`;

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', target);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('apikey', key);
    request.setRequestHeader('Content-Type', mimeTypeFor(file.name));
    request.setRequestHeader('x-upsert', 'false');

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      let body = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // Not JSON: the status alone will have to do.
      }
      reject(uploadError(request.status, body));
    };
    request.onerror = () =>
      reject(new AuthError('Unable to reach the server. Check your internet connection.', 'NETWORK_ERROR'));
    request.onabort = () => reject(new AuthError('Upload cancelled.', 'ABORTED'));

    signal?.addEventListener('abort', () => request.abort());
    request.send(file);
  });
}

export const shareConversationFile = (conversationId, path, fileName, clientId) =>
  rpc('share_conversation_file', {
    p_conversation: conversationId,
    p_path: path,
    p_file_name: fileName,
    p_client_id: clientId,
  });

export const shareChannelFile = (channelId, path, fileName, clientId) =>
  rpc('share_channel_file', {
    p_channel: channelId,
    p_path: path,
    p_file_name: fileName,
    p_client_id: clientId,
  });

/** Removes an upload that was never shared. Best effort: it can't be read by anyone else. */
export async function discardUpload(path) {
  try {
    await getSupabase().storage.from(BUCKET).remove([path]);
  } catch {
    // Harmless: an unshared object is visible only to the person who uploaded it.
  }
}

export const listSharedFiles = ({
  search,
  kind,
  conversationId,
  channelId,
  messageIds,
  channelMessageIds,
  limit = FILE_PAGE_SIZE,
  offset = 0,
}) =>
  rpc('list_shared_files', {
    p_search: search || null,
    p_kind: kind || null,
    p_limit: limit,
    p_offset: offset,
    p_conversation: conversationId ?? null,
    p_channel: channelId ?? null,
    p_message_ids: messageIds ?? null,
    p_channel_message_ids: channelMessageIds ?? null,
  });

/**
 * Removes the stored objects the database has marked for removal: this person's
 * deletions, plus any an earlier interruption left behind.
 */
export async function purgePendingFiles() {
  const paths = (await rpc('pending_file_purges')) ?? [];
  if (!paths.length) return;

  const { error } = await getSupabase().storage.from(BUCKET).remove(paths);
  if (error) throw error;
  // Asking again clears the entries for objects that have now gone.
  await rpc('pending_file_purges');
}

/** The file is unreadable as soon as this returns, even if removing the object is delayed. */
export async function deleteSharedFile(id) {
  await rpc('delete_shared_file', { p_file: id });
  // The deletion already stands. A failed clean-up is retried on the next visit.
  await purgePendingFiles().catch(() => {});
}

async function signedUrl(file, seconds, options) {
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUrl(file.storage_path, seconds, options);
  if (error || !data?.signedUrl) throw new AuthError('This file is no longer available.', 'VALIDATION_ERROR');
  return data.signedUrl;
}

export const getPreviewUrl = (file) => signedUrl(file, PREVIEW_URL_SECONDS);

export async function downloadFile(file) {
  const url = await signedUrl(file, SIGNED_URL_SECONDS, { download: file.file_name });
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Opens in a new tab. The tab must open during the click, or browsers will block it. */
export async function openFile(file) {
  const tab = window.open('', '_blank');
  try {
    const url = await signedUrl(file, SIGNED_URL_SECONDS);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
