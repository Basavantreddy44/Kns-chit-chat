-- KNS Chit-Chat, Phase 4: group conversations.
--
-- Groups share the conversations, conversation_members and messages tables with
-- direct messages, so the row level security added in Phase 2 already limits
-- reading to current members. Removing someone ends their access at once.

alter table public.conversations
  add column description text,
  add constraint conversations_description_length check (char_length(description) <= 500),
  add constraint conversations_group_name check (
    conversation_type <> 'group' or char_length(name) between 2 and 60
  );

create unique index conversation_members_one_owner
  on public.conversation_members (conversation_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'connection_request', 'connection_accepted', 'new_message',
    'channel_invitation', 'channel_message', 'channel_removed',
    'group_added', 'group_message', 'group_removed'
  ));

-- One entry per group until it's read, however many messages are posted.
create function private.notify_group_message(p_conversation uuid, p_name text, p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select m.employee_id, p_actor, 'group_message', p_conversation, 'New messages in ' || p_name
  from public.conversation_members m
  where m.conversation_id = p_conversation
    and m.employee_id <> p_actor
  on conflict (recipient_id, notification_type, reference_id) do update
    set is_read = false,
        created_at = now(),
        actor_id = excluded.actor_id,
        message = excluded.message
    where public.notifications.is_read;
$$;

create function private.notify_group_event(p_recipient uuid, p_actor uuid, p_type text, p_conversation uuid, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select p_recipient, p_actor, p_type, p_conversation, full_name || ' ' || p_text
  from public.profiles
  where id = p_actor
  on conflict (recipient_id, notification_type, reference_id) do update
    set is_read = false,
        created_at = now(),
        actor_id = excluded.actor_id,
        message = excluded.message;
$$;

create function private.clear_group_notifications(p_employee uuid, p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set is_read = true
  where recipient_id = p_employee
    and notification_type in ('group_added', 'group_message')
    and reference_id = p_conversation
    and not is_read;
$$;

create function private.group_role(p_conversation uuid, p_employee uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id and c.conversation_type = 'group'
  where m.conversation_id = p_conversation and m.employee_id = p_employee;
$$;

-- Someone outside the group gets the same answer as if it didn't exist.
create function private.require_group_manager(p_conversation uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := private.group_role(p_conversation, auth.uid());
begin
  if v_role is null then raise exception 'group_not_found'; end if;
  if v_role not in ('owner', 'admin') then raise exception 'not_group_manager'; end if;
end;
$$;

-- Adds employees connected with the adder. Anyone else stops the whole action, so
-- nobody can be pulled into a group by a stranger. Returns how many were added.
create function private.add_to_group(p_conversation uuid, p_adder uuid, p_employees uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_employee uuid;
  v_count integer := 0;
begin
  select name into v_name from public.conversations where id = p_conversation;

  for v_employee in
    select distinct requested.id
    from unnest(p_employees) as requested (id)
    where requested.id <> p_adder
      -- Someone already in the group is skipped, whoever is doing the adding.
      and not exists (
        select 1 from public.conversation_members m
        where m.conversation_id = p_conversation and m.employee_id = requested.id
      )
  loop
    if not private.are_connected(p_adder, v_employee) then raise exception 'not_connected'; end if;

    insert into public.conversation_members (conversation_id, employee_id)
    values (p_conversation, v_employee);

    v_count := v_count + 1;
    perform private.notify_group_event(v_employee, p_adder, 'group_added', p_conversation, 'added you to ' || v_name);
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct messaging, updated now that a conversation can also be a group.
-- ---------------------------------------------------------------------------
create or replace function public.send_message(p_conversation uuid, p_content text, p_client_id uuid default null)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''), E' \t\r\n');
  v_conversation public.conversations;
  v_other uuid;
  v_message public.messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select c.* into v_conversation
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id and m.employee_id = v_me
  where c.id = p_conversation;

  -- The same answer whether it doesn't exist or the caller isn't in it.
  if not found then raise exception 'conversation_not_found'; end if;

  if v_conversation.conversation_type = 'direct' then
    select employee_id into v_other from public.conversation_members
    where conversation_id = p_conversation and employee_id <> v_me;
    if v_other is null or not private.are_connected(v_me, v_other) then
      raise exception 'not_connected';
    end if;
  end if;

  if char_length(v_content) not between 1 and 4000 then raise exception 'message_invalid'; end if;

  -- A retry of a message that already arrived returns the original.
  if p_client_id is not null then
    select * into v_message from public.messages where sender_id = v_me and client_id = p_client_id;
    if found then return v_message; end if;
  end if;

  insert into public.messages (conversation_id, sender_id, content, client_id)
  values (p_conversation, v_me, v_content, p_client_id)
  returning * into v_message;

  update public.conversations set last_message_at = v_message.created_at where id = p_conversation;

  update public.conversation_members set last_read_at = v_message.created_at
  where conversation_id = p_conversation and employee_id = v_me;

  if v_conversation.conversation_type = 'group' then
    perform private.notify_group_message(p_conversation, v_conversation.name, v_me);
  else
    perform private.notify_new_message(p_conversation, v_me);
  end if;

  return v_message;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation and employee_id = auth.uid();

  update public.notifications
  set is_read = true
  where recipient_id = auth.uid()
    and notification_type in ('new_message', 'group_message', 'group_added')
    and reference_id = p_conversation
    and not is_read;
$$;

-- The Direct Messages badge counts direct conversations only.
create or replace function public.unread_message_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id and c.conversation_type = 'direct'
  join public.messages m on m.conversation_id = me.conversation_id
  where me.employee_id = auth.uid()
    and m.created_at > me.last_read_at
    and m.sender_id is distinct from auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Reads. These run as the caller, so row level security still applies.
-- ---------------------------------------------------------------------------
create function public.unread_group_message_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id and c.conversation_type = 'group'
  join public.messages m on m.conversation_id = me.conversation_id
  where me.employee_id = auth.uid()
    and m.created_at > me.last_read_at
    and m.sender_id is distinct from auth.uid();
$$;

-- The caller's groups, or one of them when p_group is given.
create function public.list_groups(
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_group uuid default null
)
returns table (
  id uuid,
  name text,
  description text,
  created_at timestamptz,
  member_count integer,
  my_role text,
  owner_name text,
  last_message text,
  last_sender_id uuid,
  last_sender_name text,
  last_message_at timestamptz,
  unread_count integer
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
  )
  select c.id, c.name, c.description, c.created_at,
    (select count(*)::integer from public.conversation_members cm where cm.conversation_id = c.id),
    me.role,
    (
      select p.full_name from public.conversation_members cm
      join public.profiles p on p.id = cm.employee_id
      where cm.conversation_id = c.id and cm.role = 'owner'
    ),
    left(latest.content, 120), latest.sender_id, sender.full_name, c.last_message_at,
    (
      select count(*)::integer from public.messages m
      where m.conversation_id = c.id
        and m.created_at > me.last_read_at
        and m.sender_id is distinct from auth.uid()
    )
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id and c.conversation_type = 'group'
  cross join pattern
  left join lateral (
    select m.content, m.sender_id from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join public.profiles sender on sender.id = latest.sender_id
  where me.employee_id = auth.uid()
    and (p_group is null or c.id = p_group)
    and (nullif(btrim(p_search), '') is null or c.name ilike pattern.value)
  order by coalesce(c.last_message_at, c.created_at) desc, c.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.list_group_members(
  p_group uuid,
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text,
  role text,
  joined_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url, m.role, m.joined_at
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id and c.conversation_type = 'group'
  join public.profiles p on p.id = m.employee_id
  where m.conversation_id = p_group
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    lower(p.full_name),
    p.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- Newest first, with the sender's name: unlike a direct chat, senders vary.
create function public.list_group_messages(
  p_group uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 40
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  message_type text,
  client_id uuid,
  created_at timestamptz,
  sender_username text,
  sender_full_name text,
  sender_avatar_url text
)
language sql
stable
set search_path = ''
as $$
  select m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.client_id, m.created_at,
    p.username, p.full_name, p.avatar_url
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_group
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.search_group_messages(
  p_group uuid,
  p_search text,
  p_limit integer default 30
)
returns table (
  id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz,
  sender_full_name text
)
language sql
stable
set search_path = ''
as $$
  select m.id, m.sender_id, m.content, m.created_at, p.full_name
  from public.messages m
  left join public.profiles p on p.id = m.sender_id
  where m.conversation_id = p_group
    and nullif(btrim(p_search), '') is not null
    and m.content ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------
create function public.create_group(
  p_name text,
  p_description text default null,
  p_members uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if char_length(v_name) not between 2 and 60 then raise exception 'group_name_invalid'; end if;
  if coalesce(array_length(p_members, 1), 0) > 100 then raise exception 'too_many_group_members'; end if;
  if not exists (select 1 from unnest(p_members) as requested (id) where requested.id <> v_me) then
    raise exception 'group_needs_members';
  end if;

  insert into public.conversations (conversation_type, name, description, created_by)
  values ('group', v_name, nullif(btrim(p_description), ''), v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, employee_id, role)
  values (v_id, v_me, 'owner');

  perform private.add_to_group(v_id, v_me, p_members);
  return v_id;
end;
$$;

create function public.update_group(p_group uuid, p_name text, p_description text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_group_manager(p_group);
  if char_length(v_name) not between 2 and 60 then raise exception 'group_name_invalid'; end if;

  update public.conversations
  set name = v_name, description = nullif(btrim(p_description), '')
  where id = p_group;
end;
$$;

create function public.add_group_members(p_group uuid, p_employees uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_group_manager(p_group);
  if coalesce(array_length(p_employees, 1), 0) > 100 then raise exception 'too_many_group_members'; end if;
  return private.add_to_group(p_group, auth.uid(), p_employees);
end;
$$;

create function public.remove_group_member(p_group uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text;
  v_target_role text;
  v_name text;
begin
  perform private.require_group_manager(p_group);
  v_my_role := private.group_role(p_group, auth.uid());
  v_target_role := private.group_role(p_group, p_employee);

  if v_target_role is null then raise exception 'not_a_group_member'; end if;
  if p_employee = auth.uid() then raise exception 'use_leave_group'; end if;
  if v_target_role = 'owner' then raise exception 'not_group_manager'; end if;
  -- Admins can remove members, but only the owner can remove another admin.
  if v_target_role = 'admin' and v_my_role <> 'owner' then raise exception 'not_group_manager'; end if;

  delete from public.conversation_members where conversation_id = p_group and employee_id = p_employee;
  perform private.clear_group_notifications(p_employee, p_group);

  select name into v_name from public.conversations where id = p_group;
  perform private.notify_group_event(p_employee, auth.uid(), 'group_removed', p_group, 'removed you from ' || v_name);
end;
$$;

-- An owner must hand over first, unless they're the last member. In that case
-- the group has nobody left to read it, so it and its messages are deleted.
create function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_role text := private.group_role(p_group, v_me);
  v_others integer;
begin
  if v_role is null then raise exception 'group_not_found'; end if;

  select count(*) into v_others from public.conversation_members
  where conversation_id = p_group and employee_id <> v_me;

  if v_role = 'owner' and v_others > 0 then raise exception 'group_owner_must_transfer'; end if;

  if v_others = 0 then
    delete from public.notifications
    where reference_id = p_group and notification_type in ('group_added', 'group_message', 'group_removed');
    delete from public.conversations where id = p_group;
    return;
  end if;

  delete from public.conversation_members where conversation_id = p_group and employee_id = v_me;
  perform private.clear_group_notifications(v_me, p_group);
end;
$$;

-- Owner only. p_role is admin, member, or owner to hand the group over.
create function public.set_group_member_role(p_group uuid, p_employee uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text := private.group_role(p_group, auth.uid());
begin
  if v_my_role is null then raise exception 'group_not_found'; end if;
  if v_my_role <> 'owner' then raise exception 'not_group_owner'; end if;
  if p_role not in ('owner', 'admin', 'member') then raise exception 'group_role_invalid'; end if;
  if p_employee = auth.uid() then raise exception 'group_role_invalid'; end if;
  if private.group_role(p_group, p_employee) is null then raise exception 'not_a_group_member'; end if;

  if p_role = 'owner' then
    update public.conversation_members set role = 'admin' where conversation_id = p_group and employee_id = auth.uid();
    update public.conversation_members set role = 'owner' where conversation_id = p_group and employee_id = p_employee;
  else
    update public.conversation_members set role = p_role where conversation_id = p_group and employee_id = p_employee;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions. Supabase grants new functions to anon by default.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.unread_group_message_count()',
    'public.list_groups(text, integer, integer, uuid)',
    'public.list_group_members(uuid, integer, integer)',
    'public.list_group_messages(uuid, timestamptz, uuid, integer)',
    'public.search_group_messages(uuid, text, integer)',
    'public.create_group(text, text, uuid[])',
    'public.update_group(uuid, text, text)',
    'public.add_group_members(uuid, uuid[])',
    'public.remove_group_member(uuid, uuid)',
    'public.leave_group(uuid)',
    'public.set_group_member_role(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
