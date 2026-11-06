import { rpc } from './employeeService';
import { MESSAGE_PAGE_SIZE } from './messagingService';

/**
 * Channels. Every call goes through a database function that checks permissions.
 * See supabase/migrations/20261104220000_channels.sql.
 */

export const CHANNEL_PAGE_SIZE = 30;
export const MEMBER_PAGE_SIZE = 30;

/** scope: 'all' (discoverable), 'mine' (joined) or 'invited'. */
export const listChannels = ({ scope, search, category, limit = CHANNEL_PAGE_SIZE, offset = 0 }) =>
  rpc('list_channels', {
    p_scope: scope,
    p_search: search || null,
    p_category: category || null,
    p_limit: limit,
    p_offset: offset,
    p_channel: null,
  });

export const getChannel = async (id) =>
  (
    await rpc('list_channels', {
      p_scope: 'all',
      p_search: null,
      p_category: null,
      p_limit: 1,
      p_offset: 0,
      p_channel: id,
    })
  )?.[0] ?? null;

export const createChannel = ({ name, description, type, category, members }) =>
  rpc('create_channel', {
    p_name: name,
    p_description: description || null,
    p_type: type,
    p_category: category || null,
    p_members: members,
  });

export const updateChannel = (id, { name, description, category }) =>
  rpc('update_channel', {
    p_channel: id,
    p_name: name,
    p_description: description || null,
    p_category: category || null,
  });

export const setChannelArchived = (id, archived) => rpc('set_channel_archived', { p_channel: id, p_archived: archived });
export const joinChannel = (id) => rpc('join_channel', { p_channel: id });
export const declineInvitation = (id) => rpc('decline_channel_invitation', { p_channel: id });
export const leaveChannel = (id) => rpc('leave_channel', { p_channel: id });

export const listChannelMembers = (id, { limit = MEMBER_PAGE_SIZE, offset = 0 }) =>
  rpc('list_channel_members', { p_channel: id, p_limit: limit, p_offset: offset });

/** Returns how many were invited: people already in the channel are skipped. */
export const inviteMembers = (id, employeeIds) =>
  rpc('invite_channel_members', { p_channel: id, p_employees: employeeIds });

export const removeMember = (id, employeeId) =>
  rpc('remove_channel_member', { p_channel: id, p_employee: employeeId });

export const setMemberRole = (id, employeeId, role) =>
  rpc('set_channel_member_role', { p_channel: id, p_employee: employeeId, p_role: role });

export const listChannelMessages = (id, before = null) =>
  rpc('list_channel_messages', {
    p_channel: id,
    p_before_created_at: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: MESSAGE_PAGE_SIZE,
  });

export const searchChannelMessages = (id, search) =>
  rpc('search_channel_messages', { p_channel: id, p_search: search, p_limit: 30 });

export const sendChannelMessage = (id, content, clientId) =>
  rpc('send_channel_message', { p_channel: id, p_content: content, p_client_id: clientId });

export const markChannelRead = (id) => rpc('mark_channel_read', { p_channel: id });

export const getUnreadChannelCount = () => rpc('unread_channel_message_count');
