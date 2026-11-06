-- KNS Chit-Chat, Phase 3: channels.
--
-- Same security model as earlier phases: browsers read through row level security
-- and every change goes through a function that takes identity from auth.uid().
--
-- Public channels can be discovered and joined by any employee, but only members
-- can read their messages. Private channels are invisible unless you are a member
-- or have been invited.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text check (char_length(description) <= 500),
  channel_type text not null check (channel_type in ('public', 'private')),
  category text check (char_length(category) between 1 and 40),
  owner_id uuid references public.profiles (id) on delete set null,
  -- Kept by a trigger, so nobody needs to read other people's membership to see it.
  member_count integer not null default 0,
  last_message_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Public names must be unique. Private ones needn't be: enforcing that would let
-- anyone discover a private channel's name by trying to create it.
create unique index channels_public_name_unique on public.channels (lower(name)) where channel_type = 'public';
create index channels_discover_idx on public.channels (channel_type, lower(name), id) where archived_at is null;
create index channels_category_idx on public.channels (category);

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function private.set_updated_at();

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  membership_status text not null default 'active' check (membership_status in ('active', 'invited')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (channel_id, employee_id)
);

create index channel_members_employee_idx on public.channel_members (employee_id, membership_status);
create unique index channel_members_one_owner on public.channel_members (channel_id) where role = 'owner';

create table public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  content text not null check (char_length(content) between 1 and 4000),
  message_type text not null default 'text' check (message_type in ('text')),
  -- Chosen by the browser, so retrying after a lost connection can't send twice.
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_messages_unique_client_id unique (sender_id, client_id)
);

create index channel_messages_channel_idx on public.channel_messages (channel_id, created_at desc, id desc);

create trigger channel_messages_set_updated_at
  before update on public.channel_messages
  for each row execute function private.set_updated_at();

create function private.sync_channel_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel uuid := coalesce(new.channel_id, old.channel_id);
begin
  update public.channels
  set member_count = (
    select count(*) from public.channel_members
    where channel_id = v_channel and membership_status = 'active'
  )
  where id = v_channel;
  return null;
end;
$$;

create trigger channel_members_sync_count
  after insert or update of membership_status or delete on public.channel_members
  for each row execute function private.sync_channel_member_count();

-- These let the policies check membership without recursing into their own table.
-- They only answer about the caller, so they reveal nothing about anyone else.
create function public.is_channel_member(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = p_channel and employee_id = auth.uid() and membership_status = 'active'
  );
$$;

create function public.is_invited_to_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = p_channel and employee_id = auth.uid() and membership_status = 'invited'
  );
$$;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.channel_messages enable row level security;

create policy "Employees can see public channels and their own private ones"
  on public.channels for select
  to authenticated
  using (
    channel_type = 'public'
    or public.is_channel_member(id)
    or public.is_invited_to_channel(id)
  );

create policy "Members can see a channel's members, and anyone their own entry"
  on public.channel_members for select
  to authenticated
  using (employee_id = (select auth.uid()) or public.is_channel_member(channel_id));

create policy "Only members can read channel messages"
  on public.channel_messages for select
  to authenticated
  using (public.is_channel_member(channel_id));

revoke all on public.channels, public.channel_members, public.channel_messages from anon, authenticated;
grant select on public.channels, public.channel_members, public.channel_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'connection_request', 'connection_accepted', 'new_message',
    'channel_invitation', 'channel_message', 'channel_removed'
  ));

-- An event that can recur for the same channel, such as being invited again.
create function private.notify_channel(
  p_recipient uuid,
  p_actor uuid,
  p_type text,
  p_channel uuid,
  p_text text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select p_recipient, p_actor, p_type, p_channel, full_name || ' ' || p_text
  from public.profiles
  where id = p_actor
  on conflict (recipient_id, notification_type, reference_id) do update
    set is_read = false,
        created_at = now(),
        actor_id = excluded.actor_id,
        message = excluded.message;
$$;

-- One entry per channel until it's read, however many messages are posted. Members
-- who already have an unread entry aren't written to, which keeps large channels cheap.
create function private.notify_channel_message(p_channel uuid, p_channel_name text, p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select m.employee_id, p_actor, 'channel_message', p_channel, 'New messages in ' || p_channel_name
  from public.channel_members m
  where m.channel_id = p_channel
    and m.membership_status = 'active'
    and m.employee_id <> p_actor
  on conflict (recipient_id, notification_type, reference_id) do update
    set is_read = false,
        created_at = now(),
        actor_id = excluded.actor_id,
        message = excluded.message
    where public.notifications.is_read;
$$;

create function private.clear_channel_notifications(p_employee uuid, p_channel uuid, p_type text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set is_read = true
  where recipient_id = p_employee
    and notification_type = p_type
    and reference_id = p_channel
    and not is_read;
$$;

create function private.channel_role(p_channel uuid, p_employee uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.channel_members
  where channel_id = p_channel and employee_id = p_employee and membership_status = 'active';
$$;

create function private.require_channel_manager(p_channel uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.channels where id = p_channel) then
    raise exception 'channel_not_found';
  end if;
  if coalesce(private.channel_role(p_channel, auth.uid()), '') not in ('owner', 'admin') then
    raise exception 'not_channel_manager';
  end if;
end;
$$;

create function private.require_not_archived(p_channel uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.channels where id = p_channel and archived_at is not null) then
    raise exception 'channel_archived';
  end if;
end;
$$;

-- Invites those who aren't already in the channel. Returns how many were invited.
create function private.invite_to_channel(p_channel uuid, p_inviter uuid, p_employees uuid[])
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
  select name into v_name from public.channels where id = p_channel;

  for v_employee in
    select distinct p.id
    from unnest(p_employees) as requested (id)
    join public.profiles p on p.id = requested.id
    where p.id <> p_inviter
  loop
    insert into public.channel_members (channel_id, employee_id, membership_status, invited_by)
    values (p_channel, v_employee, 'invited', p_inviter)
    on conflict (channel_id, employee_id) do nothing;

    if found then
      v_count := v_count + 1;
      perform private.notify_channel(v_employee, p_inviter, 'channel_invitation', p_channel, 'invited you to ' || v_name);
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads. These run as the caller, so row level security still applies.
-- ---------------------------------------------------------------------------

-- p_scope: all (what the caller can discover), mine (joined) or invited.
-- Pass p_channel to fetch one channel the caller can see.
create function public.list_channels(
  p_scope text default 'all',
  p_search text default null,
  p_category text default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_channel uuid default null
)
returns table (
  id uuid,
  name text,
  description text,
  channel_type text,
  category text,
  owner_id uuid,
  owner_name text,
  member_count integer,
  archived_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz,
  my_status text,
  my_role text,
  unread_count integer
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
  )
  select c.id, c.name, c.description, c.channel_type, c.category, c.owner_id, owner.full_name,
    c.member_count, c.archived_at, c.last_message_at, c.created_at,
    me.membership_status, me.role,
    case when me.membership_status = 'active' then (
      select count(*)::integer from public.channel_messages m
      where m.channel_id = c.id
        and m.created_at > me.last_read_at
        and m.sender_id is distinct from auth.uid()
    ) else 0 end
  from public.channels c
  cross join pattern
  left join public.profiles owner on owner.id = c.owner_id
  left join public.channel_members me on me.channel_id = c.id and me.employee_id = auth.uid()
  where (
      p_channel = c.id
      or (p_channel is null and case p_scope
        when 'all' then c.archived_at is null and (c.channel_type = 'public' or me.membership_status = 'active')
        when 'mine' then me.membership_status = 'active'
        when 'invited' then me.membership_status = 'invited' and c.archived_at is null
        else false
      end)
    )
    and (nullif(btrim(p_search), '') is null
      or c.name ilike pattern.value
      or c.description ilike pattern.value
      or c.category ilike pattern.value)
    and (p_category is null or c.category = p_category)
  order by
    (c.archived_at is not null),
    case when p_scope = 'mine' then coalesce(c.last_message_at, c.created_at) end desc nulls last,
    lower(c.name),
    c.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.list_channel_members(
  p_channel uuid,
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
  membership_status text,
  joined_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url,
    m.role, m.membership_status, m.joined_at
  from public.channel_members m
  join public.profiles p on p.id = m.employee_id
  where m.channel_id = p_channel
    -- Row level security shows non-members their own entry; a list needs membership.
    and public.is_channel_member(p_channel)
  order by
    case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    (m.membership_status = 'invited'),
    lower(p.full_name),
    p.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- Newest first. Pass the oldest message you have to page further back.
create function public.list_channel_messages(
  p_channel uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 40
)
returns table (
  id uuid,
  channel_id uuid,
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
  select m.id, m.channel_id, m.sender_id, m.content, m.message_type, m.client_id, m.created_at,
    p.username, p.full_name, p.avatar_url
  from public.channel_messages m
  left join public.profiles p on p.id = m.sender_id
  where m.channel_id = p_channel
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.search_channel_messages(
  p_channel uuid,
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
  from public.channel_messages m
  left join public.profiles p on p.id = m.sender_id
  where m.channel_id = p_channel
    and nullif(btrim(p_search), '') is not null
    and m.content ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.unread_channel_message_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.channel_members me
  join public.channel_messages m on m.channel_id = me.channel_id
  where me.employee_id = auth.uid()
    and me.membership_status = 'active'
    and m.created_at > me.last_read_at
    and m.sender_id is distinct from auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------
create function public.create_channel(
  p_name text,
  p_description text default null,
  p_type text default 'public',
  p_category text default null,
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
  if char_length(v_name) not between 2 and 60 then raise exception 'channel_name_invalid'; end if;
  if p_type not in ('public', 'private') then raise exception 'channel_type_invalid'; end if;
  if coalesce(array_length(p_members, 1), 0) > 100 then raise exception 'too_many_invitations'; end if;

  begin
    insert into public.channels (name, description, channel_type, category, owner_id)
    values (v_name, nullif(btrim(p_description), ''), p_type, nullif(btrim(p_category), ''), v_me)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'channel_name_taken';
  end;

  insert into public.channel_members (channel_id, employee_id, role, membership_status, joined_at)
  values (v_id, v_me, 'owner', 'active', now());

  perform private.invite_to_channel(v_id, v_me, p_members);
  return v_id;
end;
$$;

create function public.update_channel(
  p_channel uuid,
  p_name text,
  p_description text default null,
  p_category text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_channel_manager(p_channel);
  perform private.require_not_archived(p_channel);
  if char_length(v_name) not between 2 and 60 then raise exception 'channel_name_invalid'; end if;

  begin
    update public.channels
    set name = v_name,
        description = nullif(btrim(p_description), ''),
        category = nullif(btrim(p_category), '')
    where id = p_channel;
  exception when unique_violation then
    raise exception 'channel_name_taken';
  end;
end;
$$;

create function public.set_channel_archived(p_channel uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(private.channel_role(p_channel, auth.uid()), '') <> 'owner' then
    if not exists (select 1 from public.channels where id = p_channel) then
      raise exception 'channel_not_found';
    end if;
    raise exception 'not_channel_owner';
  end if;

  update public.channels
  set archived_at = case when p_archived then coalesce(archived_at, now()) end
  where id = p_channel;
end;
$$;

-- Joins a public channel, or accepts an invitation to any channel. For anyone else
-- a private channel looks the same as one that doesn't exist.
create function public.join_channel(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_channel public.channels;
  v_status text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select * into v_channel from public.channels where id = p_channel;
  if not found then raise exception 'channel_not_found'; end if;

  select membership_status into v_status from public.channel_members
  where channel_id = p_channel and employee_id = v_me;

  if v_channel.channel_type = 'private' and v_status is null then
    raise exception 'channel_not_found';
  end if;
  if v_channel.archived_at is not null then raise exception 'channel_archived'; end if;
  if v_status = 'active' then return; end if;

  insert into public.channel_members (channel_id, employee_id, membership_status, joined_at)
  values (p_channel, v_me, 'active', now())
  on conflict (channel_id, employee_id) do update
    set membership_status = 'active',
        joined_at = now(),
        last_read_at = now();

  perform private.clear_channel_notifications(v_me, p_channel, 'channel_invitation');
end;
$$;

create function public.decline_channel_invitation(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.channel_members
  where channel_id = p_channel and employee_id = auth.uid() and membership_status = 'invited';

  if not found then raise exception 'channel_not_found'; end if;

  perform private.clear_channel_notifications(auth.uid(), p_channel, 'channel_invitation');
end;
$$;

create function public.leave_channel(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.channel_role(p_channel, auth.uid());
begin
  if v_role is null then raise exception 'channel_not_found'; end if;
  -- A channel always keeps an owner, so ownership has to be handed over first.
  if v_role = 'owner' then raise exception 'owner_must_transfer'; end if;

  delete from public.channel_members where channel_id = p_channel and employee_id = auth.uid();
  perform private.clear_channel_notifications(auth.uid(), p_channel, 'channel_message');
end;
$$;

create function public.invite_channel_members(p_channel uuid, p_employees uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_channel_manager(p_channel);
  perform private.require_not_archived(p_channel);
  if coalesce(array_length(p_employees, 1), 0) > 100 then raise exception 'too_many_invitations'; end if;
  return private.invite_to_channel(p_channel, auth.uid(), p_employees);
end;
$$;

create function public.remove_channel_member(p_channel uuid, p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_my_role text;
  v_target public.channel_members;
  v_name text;
begin
  perform private.require_channel_manager(p_channel);
  v_my_role := private.channel_role(p_channel, auth.uid());

  select * into v_target from public.channel_members
  where channel_id = p_channel and employee_id = p_employee;
  if not found then raise exception 'not_a_channel_member'; end if;

  if p_employee = auth.uid() then raise exception 'use_leave_channel'; end if;
  if v_target.role = 'owner' then raise exception 'not_channel_manager'; end if;
  -- Admins can remove members, but only the owner can remove another admin.
  if v_target.role = 'admin' and v_my_role <> 'owner' then raise exception 'not_channel_manager'; end if;

  delete from public.channel_members where channel_id = p_channel and employee_id = p_employee;

  perform private.clear_channel_notifications(p_employee, p_channel, 'channel_invitation');
  perform private.clear_channel_notifications(p_employee, p_channel, 'channel_message');

  -- Someone who was only invited isn't told their invitation was withdrawn by name.
  if v_target.membership_status = 'active' then
    select name into v_name from public.channels where id = p_channel;
    perform private.notify_channel(p_employee, auth.uid(), 'channel_removed', p_channel, 'removed you from ' || v_name);
  end if;
end;
$$;

-- Owner only. p_role is admin, member, or owner to hand the channel over.
create function public.set_channel_member_role(p_channel uuid, p_employee uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(private.channel_role(p_channel, auth.uid()), '') <> 'owner' then
    if not exists (select 1 from public.channels where id = p_channel) then
      raise exception 'channel_not_found';
    end if;
    raise exception 'not_channel_owner';
  end if;
  if p_role not in ('owner', 'admin', 'member') then raise exception 'channel_role_invalid'; end if;
  if p_employee = auth.uid() then raise exception 'channel_role_invalid'; end if;
  if private.channel_role(p_channel, p_employee) is null then raise exception 'not_a_channel_member'; end if;

  if p_role = 'owner' then
    update public.channel_members set role = 'admin' where channel_id = p_channel and employee_id = auth.uid();
    update public.channel_members set role = 'owner' where channel_id = p_channel and employee_id = p_employee;
    update public.channels set owner_id = p_employee where id = p_channel;
  else
    update public.channel_members set role = p_role where channel_id = p_channel and employee_id = p_employee;
  end if;
end;
$$;

create function public.send_channel_message(p_channel uuid, p_content text, p_client_id uuid default null)
returns public.channel_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_content text := btrim(coalesce(p_content, ''), E' \t\r\n');
  v_name text;
  v_message public.channel_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  -- The same answer whether it doesn't exist or the caller isn't in it.
  if private.channel_role(p_channel, v_me) is null then raise exception 'channel_not_found'; end if;
  perform private.require_not_archived(p_channel);
  if char_length(v_content) not between 1 and 4000 then raise exception 'message_invalid'; end if;

  -- A retry of a message that already arrived returns the original.
  if p_client_id is not null then
    select * into v_message from public.channel_messages where sender_id = v_me and client_id = p_client_id;
    if found then return v_message; end if;
  end if;

  insert into public.channel_messages (channel_id, sender_id, content, client_id)
  values (p_channel, v_me, v_content, p_client_id)
  returning * into v_message;

  update public.channels set last_message_at = v_message.created_at where id = p_channel returning name into v_name;

  update public.channel_members set last_read_at = v_message.created_at
  where channel_id = p_channel and employee_id = v_me;

  perform private.notify_channel_message(p_channel, v_name, v_me);
  return v_message;
end;
$$;

create function public.mark_channel_read(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channel_members
  set last_read_at = now()
  where channel_id = p_channel and employee_id = auth.uid() and membership_status = 'active';

  perform private.clear_channel_notifications(auth.uid(), p_channel, 'channel_message');
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
    'public.is_channel_member(uuid)',
    'public.is_invited_to_channel(uuid)',
    'public.list_channels(text, text, text, integer, integer, uuid)',
    'public.list_channel_members(uuid, integer, integer)',
    'public.list_channel_messages(uuid, timestamptz, uuid, integer)',
    'public.search_channel_messages(uuid, text, integer)',
    'public.unread_channel_message_count()',
    'public.create_channel(text, text, text, text, uuid[])',
    'public.update_channel(uuid, text, text, text)',
    'public.set_channel_archived(uuid, boolean)',
    'public.join_channel(uuid)',
    'public.decline_channel_invitation(uuid)',
    'public.leave_channel(uuid)',
    'public.invite_channel_members(uuid, uuid[])',
    'public.remove_channel_member(uuid, uuid)',
    'public.set_channel_member_role(uuid, uuid, text)',
    'public.send_channel_message(uuid, text, uuid)',
    'public.mark_channel_read(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime. Delivery follows the select policy above, so only members receive it.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.channel_messages;
