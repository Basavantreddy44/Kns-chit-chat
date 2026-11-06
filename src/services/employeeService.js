import { AuthError } from './AuthError';
import { AUTH_MODE } from './authService';
import { getSupabase } from './supabaseClient';

/**
 * Directory, connections and notifications. Everything goes through database
 * functions, which take the caller's identity from their session and enforce
 * the rules. See supabase/migrations/20261104120000_directory_connections.sql.
 */

export const PAGE_SIZE = 24;

const FRIENDLY_MESSAGES = {
  already_connected: 'You are already connected with this employee.',
  request_already_sent: 'You have already sent this employee a request.',
  request_declined: 'This employee declined your request, so you can’t send another.',
  request_not_found: 'This request is no longer available. Refresh the page to see the latest.',
  employee_not_found: 'This employee could not be found.',
  not_connected: 'You are not connected with this employee.',
  cannot_connect_to_self: 'You can’t connect with yourself.',
  cannot_message_self: 'You can’t start a chat with yourself.',
  conversation_not_found: 'This conversation is not available.',
  message_invalid: 'Messages must be between 1 and 4,000 characters.',
  channel_not_found: 'This channel is not available.',
  channel_name_invalid: 'Channel names must be between 2 and 60 characters.',
  channel_name_taken: 'A public channel with this name already exists. Please choose another.',
  channel_type_invalid: 'Please choose whether this channel is public or private.',
  channel_archived: 'This channel is archived, so it can’t be changed.',
  channel_role_invalid: 'That role can’t be applied here.',
  not_channel_manager: 'Only the channel’s owner or an admin can do that.',
  not_channel_owner: 'Only the channel’s owner can do that.',
  not_a_channel_member: 'This employee is not in the channel.',
  owner_must_transfer: 'Make another member the owner before you leave, or archive the channel.',
  too_many_invitations: 'You can invite up to 100 people at a time.',
  group_not_found: 'This group is not available.',
  group_name_invalid: 'Group names must be between 2 and 60 characters.',
  group_needs_members: 'Add at least one of your connections to the group.',
  group_role_invalid: 'That role can’t be applied here.',
  not_group_manager: 'Only the group’s owner or an admin can do that.',
  not_group_owner: 'Only the group’s owner can do that.',
  not_a_group_member: 'This employee is not in the group.',
  group_owner_must_transfer: 'Make another member the owner before you leave.',
  too_many_group_members: 'You can add up to 100 people at a time.',
  avatar_invalid: 'The picture couldn’t be saved. Please try again.',
  cannot_call_self: 'You can’t call yourself.',
  call_type_invalid: 'That type of call isn’t available.',
  already_in_call: 'You are already in a call. It may be open in another tab.',
  employee_busy: 'This employee is on another call. Please try again later.',
  call_not_available: 'This call is no longer available.',
  file_not_found: 'This file is no longer available.',
  file_delete_not_allowed: 'Only the person who shared this file, or an owner or admin, can delete it.',
  file_invalid_path: 'This file couldn’t be shared. Please try again.',
  file_not_uploaded: 'This file didn’t finish uploading. Please try again.',
  file_already_shared: 'This file has already been shared.',
  file_name_invalid: 'This file’s name can’t be used. Please rename it and try again.',
  file_type_not_allowed: 'This file type isn’t supported.',
  file_too_large: 'This file is larger than the 25 MB limit.',
};

function toError(error) {
  if (FRIENDLY_MESSAGES[error.message]) {
    return new AuthError(FRIENDLY_MESSAGES[error.message], 'VALIDATION_ERROR');
  }
  if (error.code === 'PGRST202' || error.code === 'PGRST205') {
    return new AuthError('This feature isn’t set up on the server yet.', 'CONFIG_ERROR');
  }
  if (!error.code) {
    return new AuthError('Unable to reach the server. Check your internet connection.', 'NETWORK_ERROR');
  }
  return new AuthError('Something went wrong. Please try again.', 'SERVER_ERROR');
}

export async function rpc(name, args) {
  if (AUTH_MODE !== 'supabase') {
    throw new AuthError('Employee features need the app to be running in Supabase mode.', 'CONFIG_ERROR');
  }
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw toError(error);
  return data;
}

export const searchEmployees = ({ search, department, status, limit = PAGE_SIZE, offset = 0 }) =>
  rpc('search_employees', {
    p_search: search || null,
    p_department: department || null,
    p_status: status || null,
    p_limit: limit,
    p_offset: offset,
  });

export const getEmployee = async (id) => (await rpc('get_employee', { p_employee: id }))?.[0] ?? null;

export const listConnections = ({ limit = PAGE_SIZE, offset = 0 }) =>
  rpc('list_connections', { p_limit: limit, p_offset: offset });

export const listConnectionRequests = ({ box, limit = PAGE_SIZE, offset = 0 }) =>
  rpc('list_connection_requests', { p_box: box, p_limit: limit, p_offset: offset });

export const sendConnectionRequest = (id) => rpc('send_connection_request', { p_receiver: id });

export const respondToRequest = (requestId, accept) =>
  rpc('respond_connection_request', { p_request: requestId, p_accept: accept });

export const cancelRequest = (requestId) => rpc('cancel_connection_request', { p_request: requestId });

export const removeConnection = (id) => rpc('remove_connection', { p_employee: id });

export const listNotifications = ({ limit = PAGE_SIZE, offset = 0 }) =>
  rpc('list_notifications', { p_limit: limit, p_offset: offset });

export const getUnreadCount = () => rpc('unread_notification_count');

/** Marks one notification read, or all of them when no id is given. */
export const markNotificationsRead = (id = null) => rpc('mark_notifications_read', { p_notification: id });

export async function updateMyProfile(userId, { department, designation }) {
  if (AUTH_MODE !== 'supabase') {
    throw new AuthError('Employee features need the app to be running in Supabase mode.', 'CONFIG_ERROR');
  }
  const { error } = await getSupabase()
    .from('profiles')
    .update({ department: department || null, designation: designation?.trim() || null })
    .eq('id', userId);
  if (error) throw toError(error);
}
