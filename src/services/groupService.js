import { rpc } from './employeeService';
import { MESSAGE_PAGE_SIZE, sendMessage, markConversationRead } from './messagingService';

/**
 * Group conversations. Groups are conversations, so sending and read tracking are
 * shared with direct messages; everything else goes through group functions that
 * check permissions. See supabase/migrations/20261105090000_group_conversations.sql.
 */

export const GROUP_PAGE_SIZE = 30;
export const GROUP_MEMBER_PAGE_SIZE = 30;

export const listGroups = ({ search, limit = GROUP_PAGE_SIZE, offset = 0 }) =>
  rpc('list_groups', { p_search: search || null, p_limit: limit, p_offset: offset, p_group: null });

export const getGroup = async (id) =>
  (await rpc('list_groups', { p_search: null, p_limit: 1, p_offset: 0, p_group: id }))?.[0] ?? null;

export const createGroup = ({ name, description, members }) =>
  rpc('create_group', { p_name: name, p_description: description || null, p_members: members });

export const updateGroup = (id, { name, description }) =>
  rpc('update_group', { p_group: id, p_name: name, p_description: description || null });

export const listGroupMembers = (id, { limit = GROUP_MEMBER_PAGE_SIZE, offset = 0 }) =>
  rpc('list_group_members', { p_group: id, p_limit: limit, p_offset: offset });

/** Returns how many were added: people already in the group are skipped. */
export const addGroupMembers = (id, employeeIds) =>
  rpc('add_group_members', { p_group: id, p_employees: employeeIds });

export const removeGroupMember = (id, employeeId) =>
  rpc('remove_group_member', { p_group: id, p_employee: employeeId });

export const leaveGroup = (id) => rpc('leave_group', { p_group: id });

export const setGroupMemberRole = (id, employeeId, role) =>
  rpc('set_group_member_role', { p_group: id, p_employee: employeeId, p_role: role });

export const listGroupMessages = (id, before = null) =>
  rpc('list_group_messages', {
    p_group: id,
    p_before_created_at: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  });

export const searchGroupMessages = (id, search) =>
  rpc('search_group_messages', { p_group: id, p_search: search, p_limit: 30 });

export const sendGroupMessage = sendMessage;
export const markGroupRead = markConversationRead;

export const getUnreadGroupCount = () => rpc('unread_group_message_count');
