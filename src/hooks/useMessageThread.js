import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';

const keyOf = (message) => message.client_id ?? message.id;

function byTime(a, b) {
  // Messages still sending stay at the bottom, in the order they were written.
  if (Boolean(a.pending) !== Boolean(b.pending)) return a.pending ? 1 : -1;
  if (a.created_at !== b.created_at) return new Date(a.created_at) - new Date(b.created_at);
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Combines messages from any source without duplicates. The sender's own copy
 * arrives twice (the send response and Realtime), so both are keyed by client id.
 */
function merge(current, incoming) {
  const merged = new Map(current.map((message) => [keyOf(message), message]));
  incoming.forEach((message) => merged.set(keyOf(message), { ...merged.get(keyOf(message)), ...message, pending: message.pending, failed: message.failed }));
  return [...merged.values()].sort(byTime);
}

/**
 * The messages in one thread, for direct chats and channels alike: loading, live
 * updates, sending, retrying and read state. `source` must be a stable object:
 *
 *   { id, eventType, belongs(row), fetchPage(before), post(content, clientId),
 *     markRead(), draftFields, pageSize }
 */
export function useMessageThread(source, userId) {
  const { subscribeToMessages, resyncAt, refreshUnread } = useWorkspace();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      await source.markRead();
      await refreshUnread();
    } catch {
      // Not fatal: it stays unread until the next successful attempt.
    }
  }, [source, refreshUnread]);

  const load = useCallback(
    async (isCurrent = () => true) => {
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      try {
        const page = (await source.fetchPage(null)) ?? [];
        if (!isCurrent()) return;
        setMessages((current) => merge(current, page));
        setHasOlder((current) => current || page.length === source.pageSize);
        setStatus('ready');
        setError('');
        markRead();
      } catch (loadError) {
        if (!isCurrent()) return;
        setStatus((current) => (current === 'ready' ? current : 'error'));
        setError(loadError?.message || 'Something went wrong. Please try again.');
      }
    },
    [source, markRead],
  );

  // Opening a different thread starts from nothing.
  useEffect(() => {
    let isActive = true;
    setMessages([]);
    setHasOlder(false);
    setStatus('loading');
    load(() => isActive);
    return () => {
      isActive = false;
    };
  }, [load]);

  // After a reconnect, or coming back to the tab, fetch anything that was missed.
  useEffect(() => {
    if (!resyncAt) return undefined;
    let isActive = true;
    load(() => isActive);
    return () => {
      isActive = false;
    };
  }, [resyncAt, load]);

  useEffect(
    () =>
      subscribeToMessages(({ type, row }) => {
        if (type !== source.eventType || !source.belongs(row)) return;
        setMessages((current) => merge(current, [row]));
        if (row.sender_id !== userId) markRead();
      }),
    [subscribeToMessages, source, userId, markRead],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messages.find((message) => !message.pending);
    if (!oldest) return;
    setIsLoadingOlder(true);
    try {
      const page = (await source.fetchPage(oldest)) ?? [];
      setMessages((current) => merge(current, page));
      setHasOlder(page.length === source.pageSize);
    } catch (loadError) {
      setError(loadError?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoadingOlder(false);
    }
  }, [source, messages]);

  const deliver = useCallback(
    async (draft) => {
      setMessages((current) => merge(current, [{ ...draft, pending: true, failed: false, failure: '' }]));
      try {
        const saved = await source.post(draft.content, draft.client_id);
        setMessages((current) => merge(current, [{ ...saved, pending: false, failed: false, failure: '' }]));
      } catch (sendError) {
        setMessages((current) =>
          merge(current, [
            {
              ...draft,
              pending: true,
              failed: true,
              failure: sendError?.message || 'Your message couldn’t be sent.',
            },
          ]),
        );
      }
    },
    [source],
  );

  const send = useCallback(
    (content) =>
      deliver({
        id: null,
        client_id: crypto.randomUUID(),
        sender_id: userId,
        content,
        created_at: new Date().toISOString(),
        ...source.draftFields,
      }),
    [source, deliver, userId],
  );

  /** Adds a message that was created another way, such as by sharing a file. */
  const receive = useCallback((row) => {
    setMessages((current) => merge(current, [{ ...row, pending: false, failed: false, failure: '' }]));
  }, []);

  const discard = useCallback((message) => {
    setMessages((current) => current.filter((item) => keyOf(item) !== keyOf(message)));
  }, []);

  return { messages, status, error, hasOlder, isLoadingOlder, loadOlder, send, receive, retry: deliver, discard, reload: load };
}
