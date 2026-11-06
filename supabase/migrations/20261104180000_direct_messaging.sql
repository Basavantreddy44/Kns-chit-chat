-- KNS Chit-Chat, Phase 2: direct messaging.
--
-- Same security model as Phase 1: browsers read through row level security and
-- every change goes through a function that takes identity from auth.uid().
-- The tables also carry what Phase 4 group chats will need.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null check (conversation_type in ('direct', 'group')),
  name text,
  created_by uuid references public.profiles (id) on delete set null,
  -- Set for direct conversations, lower id first, so a pair can only ever have one.
  direct_employee_one uuid references public.profiles (id) on delete set null,
  direct_employee_two uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversations_direct_ordered check (direct_employee_one < direct_employee_two),
  constraint conversations_direct_unique_pair unique (direct_employee_one, direct_employee_two)
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, employee_id)
);

create index conversation_members_employee_idx on public.conversation_members (employee_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  content text not null check (char_length(content) between 1 and 4000),
  message_type text not null default 'text' check (message_type in ('text')),
  -- Chosen by the browser, so retrying after a lost connection can't send twice.
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_unique_client_id unique (sender_id, client_id)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at desc, id desc);

create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function private.set_updated_at();

-- Lets the policies below check membership without recursing into their own
-- table. It only answers about the caller, so it reveals nothing about others.
create function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and employee_id = auth.uid()
  );
$$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

create policy "Only participants can read a conversation"
  on public.conversations for select
  to authenticated
  using (public.is_conversation_member(id));

create policy "Only participants can see who is in a conversation"
  on public.conversation_members for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "Only participants can read messages"
  on public.messages for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

revoke all on public.conversations, public.conversation_members, public.messages from anon, authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: one rolling entry per conversation, not one per message.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in ('connection_request', 'connection_accepted', 'new_message'));

create function private.notify_new_message(p_conversation uuid, p_actor uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select m.employee_id, p_actor, 'new_message', p_conversation, p.full_name || ' sent you a message'
  from public.conversation_members m
  cross join public.profiles p
  where m.conversation_id = p_conversation
    and m.employee_id <> p_actor
    and p.id = p_actor
  on conflict (recipient_id, notification_type, reference_id) do update
    set is_read = false,
        created_at = now(),
        actor_id = excluded.actor_id,
        message = excluded.message;
$$;

create function private.are_connected(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employee_connections
    where employee_one_id = least(p_one, p_two) and employee_two_id = greatest(p_one, p_two)
  );
$$;

-- ---------------------------------------------------------------------------
-- Reads. These run as the caller, so row level security still applies.
-- ---------------------------------------------------------------------------

-- The caller's direct conversations, or one of them when p_conversation is given.
create function public.list_conversations(
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_conversation uuid default null
)
returns table (
  id uuid,
  employee_id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text,
  last_message text,
  last_sender_id uuid,
  last_message_at timestamptz,
  unread_count integer,
  is_connected boolean,
  other_last_read_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
  )
  select c.id, other.employee_id, p.username, p.full_name, p.department, p.designation, p.avatar_url,
    left(latest.content, 120), latest.sender_id, c.last_message_at,
    (
      select count(*)::integer from public.messages m
      where m.conversation_id = c.id
        and m.created_at > me.last_read_at
        and m.sender_id is distinct from auth.uid()
    ),
    exists (
      select 1 from public.employee_connections ec
      where ec.employee_one_id = least(auth.uid(), other.employee_id)
        and ec.employee_two_id = greatest(auth.uid(), other.employee_id)
    ),
    other.last_read_at
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id and c.conversation_type = 'direct'
  cross join pattern
  left join public.conversation_members other
    on other.conversation_id = c.id and other.employee_id <> me.employee_id
  left join public.profiles p on p.id = other.employee_id
  left join lateral (
    select m.content, m.sender_id from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  where me.employee_id = auth.uid()
    and (p_conversation is null or c.id = p_conversation)
    -- A chat someone opened but hasn't written in stays out of the other person's list.
    and (p_conversation is not null or c.last_message_at is not null or c.created_by = auth.uid())
    and (nullif(btrim(p_search), '') is null
      or p.full_name ilike pattern.value
      or p.username ilike pattern.value)
  order by coalesce(c.last_message_at, c.created_at) desc, c.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- Newest first. Pass the oldest message you have to page further back.
create function public.list_messages(
  p_conversation uuid,
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
  created_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select m.id, m.conversation_id, m.sender_id, m.content, m.message_type, m.client_id, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.search_messages(
  p_conversation uuid,
  p_search text,
  p_limit integer default 30
)
returns table (
  id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select m.id, m.sender_id, m.content, m.created_at
  from public.messages m
  where m.conversation_id = p_conversation
    and nullif(btrim(p_search), '') is not null
    and m.content ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc, m.id desc
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.unread_message_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.conversation_members me
  join public.messages m on m.conversation_id = me.conversation_id
  where me.employee_id = auth.uid()
    and m.created_at > me.last_read_at
    and m.sender_id is distinct from auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------

-- Returns the pair's conversation, creating it if needed. Creating one needs an
-- accepted connection; an existing one stays reachable so history isn't lost.
create function public.start_direct_conversation(p_employee uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_one uuid := least(v_me, p_employee);
  v_two uuid := greatest(v_me, p_employee);
  v_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_employee = v_me then raise exception 'cannot_message_self'; end if;

  perform pg_advisory_xact_lock(hashtextextended('direct' || v_one::text || v_two::text, 0));

  select id into v_id from public.conversations
  where direct_employee_one = v_one and direct_employee_two = v_two;
  if found then return v_id; end if;

  if not private.are_connected(v_me, p_employee) then raise exception 'not_connected'; end if;

  insert into public.conversations (conversation_type, created_by, direct_employee_one, direct_employee_two)
  values ('direct', v_me, v_one, v_two)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, employee_id)
  values (v_id, v_me), (v_id, p_employee);

  return v_id;
end;
$$;

create function public.send_message(p_conversation uuid, p_content text, p_client_id uuid default null)
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

  perform private.notify_new_message(p_conversation, v_me);

  return v_message;
end;
$$;

create function public.mark_conversation_read(p_conversation uuid)
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
    and notification_type = 'new_message'
    and reference_id = p_conversation
    and not is_read;
$$;

-- ---------------------------------------------------------------------------
-- Function permissions. Supabase grants new functions to anon by default.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_conversation_member(uuid)',
    'public.list_conversations(text, integer, integer, uuid)',
    'public.list_messages(uuid, timestamptz, uuid, integer)',
    'public.search_messages(uuid, text, integer)',
    'public.unread_message_count()',
    'public.start_direct_conversation(uuid)',
    'public.send_message(uuid, text, uuid)',
    'public.mark_conversation_read(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime. Delivery follows the select policies above, so only participants
-- receive these events.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages, public.conversation_members;
