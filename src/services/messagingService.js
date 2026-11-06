import { rpc } from './employeeService';

/**
 * Direct messaging. Every call goes through a database function that checks the
 * caller is a participant. See supabase/migrations/20261104180000_direct_messaging.sql.
 */

export const CONVERSATION_PAGE_SIZE = 30;
export const MESSAGE_PAGE_SIZE = 40;
export const MAX_MESSAGE_LENGTH = 4000;

export const listConversations = ({ search, limit = CONVERSATION_PAGE_SIZE, offset = 0 }) =>
  rpc('list_conversations', { p_search: search || null, p_limit: limit, p_offset: offset, p_conversation: null });

export const getConversation = async (id) =>
  (await rpc('list_conversations', { p_search: null, p_limit: 1, p_offset: 0, p_conversation: id }))?.[0] ?? null;

/** Returns the conversation with this employee, creating it if needed. */
export const startDirectConversation = (employeeId) =>
  rpc('start_direct_conversation', { p_employee: employeeId });

/** Newest first. Pass the oldest message you have as `before` to page back. */
export const listMessages = (conversationId, before = null) =>
  rpc('list_messages', {
    p_conversation: conversationId,
    p_before_created_at: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  });

export const searchMessages = (conversationId, search) =>
  rpc('search_messages', { p_conversation: conversationId, p_search: search, p_limit: 30 });

/** `clientId` makes retries safe: the same id never creates a second message. */
export const sendMessage = (conversationId, content, clientId) =>
  rpc('send_message', { p_conversation: conversationId, p_content: content, p_client_id: clientId });

export const markConversationRead = (conversationId) =>
  rpc('mark_conversation_read', { p_conversation: conversationId });

export const getUnreadMessageCount = () => rpc('unread_message_count');
