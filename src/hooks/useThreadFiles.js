import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_FILES_AT_ONCE, validateFile } from '../config/fileTypes';
import { useWorkspace } from '../context/WorkspaceContext';
import { discardUpload, listSharedFiles, uploadFile } from '../services/fileService';

/**
 * Uploading into one thread. Each file goes through its own stages:
 * uploading, then sharing, then gone from this list once it's a message.
 *
 *   target: { prefix: 'conversations/<id>', share(path, name, clientId) }
 */
export function useFileUploads(target, onShared) {
  const [uploads, setUploads] = useState([]);
  const controllers = useRef(new Map());

  const update = useCallback((id, changes) => {
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const run = useCallback(
    async (item) => {
      const path = `${target.prefix}/${crypto.randomUUID()}`;
      const controller = new AbortController();
      controllers.current.set(item.id, controller);
      update(item.id, { status: 'uploading', progress: 0, error: '' });

      try {
        await uploadFile(path, item.file, {
          signal: controller.signal,
          onProgress: (progress) => update(item.id, { progress }),
        });
      } catch (error) {
        controllers.current.delete(item.id);
        if (error?.code === 'ABORTED') {
          setUploads((current) => current.filter((entry) => entry.id !== item.id));
          discardUpload(path);
          return;
        }
        update(item.id, { status: 'failed', error: error?.message || 'The upload failed.', canRetry: true });
        return;
      }

      update(item.id, { status: 'sharing', progress: 1 });
      try {
        const message = await target.share(path, item.file.name, item.clientId);
        controllers.current.delete(item.id);
        setUploads((current) => current.filter((entry) => entry.id !== item.id));
        onShared?.(message);
      } catch (error) {
        controllers.current.delete(item.id);
        discardUpload(path);
        update(item.id, { status: 'failed', error: error?.message || 'The file couldn’t be shared.', canRetry: true });
      }
    },
    [target, update, onShared],
  );

  const addFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList ?? []);
      if (!files.length) return;

      const accepted = files.slice(0, MAX_FILES_AT_ONCE);
      const entries = accepted.map((file) => {
        const reason = validateFile(file);
        return {
          id: crypto.randomUUID(),
          clientId: crypto.randomUUID(),
          file,
          status: reason ? 'failed' : 'uploading',
          progress: 0,
          error: reason,
          canRetry: false,
        };
      });
      const overflow = files.slice(MAX_FILES_AT_ONCE).map((file) => ({
        id: crypto.randomUUID(),
        clientId: crypto.randomUUID(),
        file,
        status: 'failed',
        progress: 0,
        error: `You can share up to ${MAX_FILES_AT_ONCE} files at a time.`,
        canRetry: false,
      }));

      setUploads((current) => [...current, ...entries, ...overflow]);
      entries.filter((entry) => entry.status === 'uploading').forEach(run);
    },
    [run],
  );

  const retry = useCallback((item) => run(item), [run]);
  const cancel = useCallback((item) => controllers.current.get(item.id)?.abort(), []);
  const dismiss = useCallback((item) => {
    setUploads((current) => current.filter((entry) => entry.id !== item.id));
  }, []);

  return { uploads, addFiles, retry, cancel, dismiss };
}

/**
 * Finds the file behind each file message in a thread. `kind` says which id to look
 * up by: 'conversation' or 'channel'. A message with no file left maps to null.
 */
export function useMessageFiles(messages, kind) {
  const { resyncAt } = useWorkspace();
  const [files, setFiles] = useState({});
  const requested = useRef(new Set());

  useEffect(() => {
    requested.current = new Set();
    setFiles({});
  }, [resyncAt]);

  useEffect(() => {
    const ids = messages
      .filter((message) => message.message_type === 'file' && message.id && !requested.current.has(message.id))
      .map((message) => message.id);
    if (!ids.length) return;

    ids.forEach((id) => requested.current.add(id));
    listSharedFiles({
      ...(kind === 'channel' ? { channelMessageIds: ids } : { messageIds: ids }),
      limit: 100,
    })
      .then((rows) => {
        const found = Object.fromEntries(ids.map((id) => [id, null]));
        (rows ?? []).forEach((row) => {
          found[kind === 'channel' ? row.channel_message_id : row.message_id] = row;
        });
        setFiles((current) => ({ ...current, ...found }));
      })
      .catch(() => {
        ids.forEach((id) => requested.current.delete(id));
      });
  }, [messages, kind, resyncAt]);

  const markDeleted = useCallback((messageId) => {
    setFiles((current) => ({ ...current, [messageId]: null }));
  }, []);

  return { files, markDeleted };
}
