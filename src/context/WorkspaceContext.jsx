import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { AUTH_MODE } from '../services/authService';
import { getUnreadChannelCount } from '../services/channelService';
import { getUnreadCount } from '../services/employeeService';
import { purgePendingFiles } from '../services/fileService';
import { getUnreadGroupCount } from '../services/groupService';
import { getUnreadMessageCount } from '../services/messagingService';
import { getSupabase } from '../services/supabaseClient';

/**
 * Live data the whole workspace shares: who is online, unread counts and new
 * messages. It owns all of the app's Realtime subscriptions, so pages don't each
 * open their own. Row level security limits delivery to the signed-in employee's
 * own notifications and conversations.
 */
const WorkspaceContext = createContext(null);

const PRESENCE_TOPIC = 'employees-online';

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadChannels, setUnreadChannels] = useState(0);
  const [unreadGroups, setUnreadGroups] = useState(0);
  const [onlineIds, setOnlineIds] = useState(() => new Set());
  // Pages reload when this changes, so new notifications appear without a refresh.
  const [lastEventAt, setLastEventAt] = useState(0);
  // Changes after a reconnect or returning to the tab, when events may have been missed.
  const [resyncAt, setResyncAt] = useState(0);
  const messageListeners = useRef(new Set());

  const refreshUnread = useCallback(async () => {
    // Each count stands alone: one failing doesn't hold back the others.
    const apply = async (fetchCount, setCount) => {
      try {
        setCount((await fetchCount()) ?? 0);
      } catch {
        // Not fatal: the badge catches up on the next refresh.
      }
    };
    await Promise.all([
      apply(getUnreadCount, setUnreadCount),
      apply(getUnreadMessageCount, setUnreadMessages),
      apply(getUnreadChannelCount, setUnreadChannels),
      apply(getUnreadGroupCount, setUnreadGroups),
    ]);
  }, []);

  /** Listens for { type: 'message' | 'read' | 'channel_message', row }. Returns an unsubscribe. */
  const subscribeToMessages = useCallback((listener) => {
    messageListeners.current.add(listener);
    return () => messageListeners.current.delete(listener);
  }, []);

  useEffect(() => {
    if (AUTH_MODE !== 'supabase' || !userId) return undefined;

    refreshUnread();
    // Finishes removing any stored files an earlier deletion couldn't get to.
    purgePendingFiles().catch(() => {});

    const handleFocus = () => {
      refreshUnread();
      setResyncAt(Date.now());
    };
    window.addEventListener('focus', handleFocus);

    const supabase = getSupabase();
    const emit = (event) => messageListeners.current.forEach((listener) => listener(event));
    let channels = [];
    let isCancelled = false;

    const subscribe = () => {
      const notificationChannel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
          (payload) => {
            refreshUnread();
            // Marking something read also fires an update; only new or re-opened ones matter.
            if (payload.eventType !== 'DELETE' && !payload.new?.is_read) setLastEventAt(Date.now());
          },
        )
        .subscribe();

      let hasSubscribed = false;
      const messageChannel = supabase
        .channel(`messages:${userId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
          emit({ type: 'message', row: payload.new });
          if (payload.new.sender_id !== userId) refreshUnread();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, (payload) => {
          emit({ type: 'read', row: payload.new });
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_messages' }, (payload) => {
          emit({ type: 'channel_message', row: payload.new });
          if (payload.new.sender_id !== userId) refreshUnread();
        })
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          // Subscribing again means the connection dropped: fetch what was missed.
          if (hasSubscribed) {
            refreshUnread();
            setResyncAt(Date.now());
          }
          hasSubscribed = true;
        });

      const presenceChannel = supabase.channel(PRESENCE_TOPIC, {
        config: { private: true, presence: { key: userId } },
      });
      presenceChannel
        .on('presence', { event: 'sync' }, () => {
          setOnlineIds(new Set(Object.keys(presenceChannel.presenceState())));
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') presenceChannel.track({ online_at: new Date().toISOString() });
        });

      channels = [notificationChannel, messageChannel, presenceChannel];
    };

    // Joining before the saved session is restored would join as an anonymous
    // visitor, and row level security would then withhold every live event. This
    // happens after a page refresh, so wait for the token first.
    supabase.realtime
      .setAuth()
      .catch(() => {
        // Subscribe anyway: the client retries auth, and a focus or reconnect catches up.
      })
      .then(() => {
        if (!isCancelled) subscribe();
      });

    return () => {
      isCancelled = true;
      window.removeEventListener('focus', handleFocus);
      channels.forEach((channel) => supabase.removeChannel(channel));
    };
  }, [userId, refreshUnread]);

  const value = useMemo(
    () => ({
      unreadCount,
      unreadMessages,
      unreadChannels,
      unreadGroups,
      onlineIds,
      lastEventAt,
      resyncAt,
      refreshUnread,
      subscribeToMessages,
    }),
    [
      unreadCount,
      unreadMessages,
      unreadChannels,
      unreadGroups,
      onlineIds,
      lastEventAt,
      resyncAt,
      refreshUnread,
      subscribeToMessages,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside <WorkspaceProvider>.');
  return context;
}
