import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  listMessages,
  markConversationRead,
  MESSAGE_PAGE_SIZE,
  sendMessage,
} from '../services/messagingService';
import { useMessageThread } from './useMessageThread';

/** One direct conversation's messages, plus when the other person last read it. */
export function useConversationThread(conversationId, userId) {
  const { subscribeToMessages } = useWorkspace();
  const [otherLastReadAt, setOtherLastReadAt] = useState(null);

  const source = useMemo(
    () => ({
      eventType: 'message',
      belongs: (row) => row.conversation_id === conversationId,
      fetchPage: (before) => listMessages(conversationId, before),
      post: (content, clientId) => sendMessage(conversationId, content, clientId),
      markRead: () => markConversationRead(conversationId),
      draftFields: { conversation_id: conversationId },
      pageSize: MESSAGE_PAGE_SIZE,
    }),
    [conversationId],
  );

  const thread = useMessageThread(source, userId);

  useEffect(() => {
    setOtherLastReadAt(null);
    return subscribeToMessages(({ type, row }) => {
      if (type === 'read' && row.conversation_id === conversationId && row.employee_id !== userId) {
        setOtherLastReadAt(row.last_read_at);
      }
    });
  }, [subscribeToMessages, conversationId, userId]);

  return { ...thread, otherLastReadAt };
}
