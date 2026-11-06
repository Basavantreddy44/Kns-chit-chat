-- KNS Chit-Chat, Phase 1: employee directory, connections and notifications.
--
-- Security model: browsers can only read rows they are entitled to, through row
-- level security. Every change goes through a function below that takes the
-- caller's identity from auth.uid(), never from a request parameter.

create schema if not exists private;
revoke all on schema private from public;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles become the employee directory. They hold no email or auth details.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column department text,
  add column designation text,
  add column updated_at timestamptz not null default now(),
  add constraint profiles_department_length check (char_length(department) between 1 and 60),
  add constraint profiles_designation_length check (char_length(designation) between 1 and 80);

create index profiles_department_idx on public.profiles (department);
create index profiles_full_name_idx on public.profiles (lower(full_name), id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

drop policy "Users can read their own profile" on public.profiles;

create policy "Employees can read the directory"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Employees can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Column grant: username, name and id can't be changed through this path.
grant update (department, designation) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Connection requests
-- ---------------------------------------------------------------------------
create table public.connection_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_requests_not_self check (sender_id <> receiver_id)
);

-- One open request per pair of employees, whichever of them sent it.
create unique index connection_requests_one_pending_per_pair
  on public.connection_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id))
  where status = 'pending';

create index connection_requests_receiver_idx on public.connection_requests (receiver_id, status, created_at desc);
create index connection_requests_sender_idx on public.connection_requests (sender_id, status, created_at desc);

create trigger connection_requests_set_updated_at
  before update on public.connection_requests
  for each row execute function private.set_updated_at();

alter table public.connection_requests enable row level security;

create policy "Only the sender and receiver can read a request"
  on public.connection_requests for select
  to authenticated
  using ((select auth.uid()) in (sender_id, receiver_id));

-- ---------------------------------------------------------------------------
-- Connections: one row per pair, stored with the lower id first.
-- ---------------------------------------------------------------------------
create table public.employee_connections (
  id uuid primary key default gen_random_uuid(),
  employee_one_id uuid not null references public.profiles (id) on delete cascade,
  employee_two_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint employee_connections_ordered check (employee_one_id < employee_two_id),
  constraint employee_connections_unique_pair unique (employee_one_id, employee_two_id)
);

create index employee_connections_two_idx on public.employee_connections (employee_two_id);

alter table public.employee_connections enable row level security;

create policy "Only the two employees can read a connection"
  on public.employee_connections for select
  to authenticated
  using ((select auth.uid()) in (employee_one_id, employee_two_id));

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  notification_type text not null check (notification_type in ('connection_request', 'connection_accepted')),
  reference_id uuid not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  -- The same event can't notify the same person twice.
  constraint notifications_unique_event unique (recipient_id, notification_type, reference_id)
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where not is_read;

alter table public.notifications enable row level security;

create policy "Employees can read their own notifications"
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = recipient_id);

-- Read-only for browsers. Writes happen only inside the functions below.
revoke all on public.connection_requests, public.employee_connections, public.notifications from anon, authenticated;
grant select on public.connection_requests, public.employee_connections, public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers: the private schema isn't reachable from the API.
-- ---------------------------------------------------------------------------
create function private.notify(
  p_recipient uuid,
  p_actor uuid,
  p_type text,
  p_reference uuid,
  p_text text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
  select p_recipient, p_actor, p_type, p_reference, full_name || ' ' || p_text
  from public.profiles
  where id = p_actor
  on conflict (recipient_id, notification_type, reference_id) do nothing;
$$;

create function private.accept_request(p_request_id uuid, p_sender uuid, p_receiver uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connection_requests set status = 'accepted' where id = p_request_id;

  insert into public.employee_connections (employee_one_id, employee_two_id)
  values (least(p_sender, p_receiver), greatest(p_sender, p_receiver))
  on conflict (employee_one_id, employee_two_id) do nothing;

  update public.notifications
  set is_read = true
  where recipient_id = p_receiver
    and notification_type = 'connection_request'
    and reference_id = p_request_id;

  perform private.notify(p_sender, p_receiver, 'connection_accepted', p_request_id, 'accepted your connection request');
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads. These run as the caller, so row level security still applies.
-- ---------------------------------------------------------------------------

-- Where the caller stands with another employee.
create function public.connection_state(p_employee uuid)
returns table (status text, request_id uuid)
language sql
stable
set search_path = ''
as $$
  select
    case
      when p_employee = auth.uid() then 'self'
      when exists (
        select 1 from public.employee_connections c
        where c.employee_one_id = least(auth.uid(), p_employee)
          and c.employee_two_id = greatest(auth.uid(), p_employee)
      ) then 'connected'
      when latest.status = 'pending' and latest.sender_id = auth.uid() then 'request_sent'
      when latest.status = 'pending' then 'request_received'
      when latest.status = 'rejected' and latest.sender_id = auth.uid() then 'request_declined'
      else 'none'
    end,
    case when latest.status = 'pending' then latest.id end
  from (select 1) as one
  left join lateral (
    select r.id, r.status, r.sender_id
    from public.connection_requests r
    where least(r.sender_id, r.receiver_id) = least(auth.uid(), p_employee)
      and greatest(r.sender_id, r.receiver_id) = greatest(auth.uid(), p_employee)
    order by r.created_at desc, r.id desc
    limit 1
  ) as latest on true;
$$;

create function public.search_employees(
  p_search text default null,
  p_department text default null,
  p_status text default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text,
  connection_status text,
  request_id uuid
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
  )
  select p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url, state.status, state.request_id
  from public.profiles p
  cross join pattern
  cross join lateral public.connection_state(p.id) as state
  where p.id <> auth.uid()
    and (nullif(btrim(p_search), '') is null
      or p.full_name ilike pattern.value
      or p.username ilike pattern.value
      or p.department ilike pattern.value)
    and (p_department is null or p.department = p_department)
    and (p_status is null or state.status = p_status)
  order by lower(p.full_name), p.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.get_employee(p_employee uuid)
returns table (
  id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text,
  connection_status text,
  request_id uuid
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url, state.status, state.request_id
  from public.profiles p
  cross join lateral public.connection_state(p.id) as state
  where p.id = p_employee;
$$;

create function public.list_connections(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text,
  connection_status text,
  request_id uuid,
  connected_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url,
    'connected', null::uuid, c.created_at
  from public.employee_connections c
  join public.profiles p
    on p.id = case when c.employee_one_id = auth.uid() then c.employee_two_id else c.employee_one_id end
  where auth.uid() in (c.employee_one_id, c.employee_two_id)
  order by lower(p.full_name), p.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- p_box: incoming, sent, accepted or rejected.
create function public.list_connection_requests(
  p_box text,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  status text,
  direction text,
  created_at timestamptz,
  updated_at timestamptz,
  id uuid,
  username text,
  full_name text,
  department text,
  designation text,
  avatar_url text
)
language sql
stable
set search_path = ''
as $$
  select r.id, r.status,
    case when r.sender_id = auth.uid() then 'sent' else 'received' end,
    r.created_at, r.updated_at,
    p.id, p.username, p.full_name, p.department, p.designation, p.avatar_url
  from public.connection_requests r
  join public.profiles p
    on p.id = case when r.sender_id = auth.uid() then r.receiver_id else r.sender_id end
  where auth.uid() in (r.sender_id, r.receiver_id)
    and case p_box
      when 'incoming' then r.status = 'pending' and r.receiver_id = auth.uid()
      when 'sent' then r.status = 'pending' and r.sender_id = auth.uid()
      when 'accepted' then r.status = 'accepted'
      when 'rejected' then r.status = 'rejected'
      else false
    end
  order by r.updated_at desc, r.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.list_notifications(
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  id uuid,
  notification_type text,
  reference_id uuid,
  message text,
  is_read boolean,
  created_at timestamptz,
  actor_id uuid
)
language sql
stable
set search_path = ''
as $$
  select n.id, n.notification_type, n.reference_id, n.message, n.is_read, n.created_at, n.actor_id
  from public.notifications n
  where n.recipient_id = auth.uid()
  order by n.created_at desc, n.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.unread_notification_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.notifications
  where recipient_id = auth.uid() and not is_read;
$$;

-- ---------------------------------------------------------------------------
-- Changes. security definer is needed because browsers have no write access;
-- each function checks that the caller is allowed before doing anything.
-- ---------------------------------------------------------------------------
create function public.send_connection_request(p_receiver uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_latest public.connection_requests;
  v_request_id uuid;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_receiver = v_me then raise exception 'cannot_connect_to_self'; end if;
  if not exists (select 1 from public.profiles where id = p_receiver) then
    raise exception 'employee_not_found';
  end if;

  -- Two people pressing Connect at the same moment are handled one at a time.
  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_receiver)::text || greatest(v_me, p_receiver)::text, 0));

  if exists (
    select 1 from public.employee_connections
    where employee_one_id = least(v_me, p_receiver) and employee_two_id = greatest(v_me, p_receiver)
  ) then
    raise exception 'already_connected';
  end if;

  select * into v_latest
  from public.connection_requests r
  where least(r.sender_id, r.receiver_id) = least(v_me, p_receiver)
    and greatest(r.sender_id, r.receiver_id) = greatest(v_me, p_receiver)
  order by r.created_at desc, r.id desc
  limit 1;

  if v_latest.status = 'pending' then
    if v_latest.sender_id = v_me then raise exception 'request_already_sent'; end if;
    -- They already asked to connect with me, so this is a yes.
    perform private.accept_request(v_latest.id, v_latest.sender_id, v_latest.receiver_id);
    return v_latest.id;
  end if;

  -- A declined sender can't keep asking. The person who declined still can.
  if v_latest.status = 'rejected' and v_latest.sender_id = v_me then
    raise exception 'request_declined';
  end if;

  insert into public.connection_requests (sender_id, receiver_id)
  values (v_me, p_receiver)
  returning id into v_request_id;

  perform private.notify(p_receiver, v_me, 'connection_request', v_request_id, 'sent you a connection request');
  return v_request_id;
end;
$$;

create function public.respond_connection_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.connection_requests;
begin
  select * into v_request
  from public.connection_requests
  where id = p_request and receiver_id = auth.uid() and status = 'pending'
  for update;

  -- The same answer whether it doesn't exist or isn't the caller's to answer.
  if not found then raise exception 'request_not_found'; end if;

  if p_accept then
    perform private.accept_request(v_request.id, v_request.sender_id, v_request.receiver_id);
  else
    update public.connection_requests set status = 'rejected' where id = v_request.id;
    update public.notifications
    set is_read = true
    where recipient_id = v_request.receiver_id
      and notification_type = 'connection_request'
      and reference_id = v_request.id;
  end if;
end;
$$;

create function public.cancel_connection_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connection_requests
  set status = 'cancelled'
  where id = p_request and sender_id = auth.uid() and status = 'pending';

  if not found then raise exception 'request_not_found'; end if;

  delete from public.notifications
  where notification_type = 'connection_request' and reference_id = p_request;
end;
$$;

create function public.remove_connection(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.employee_connections
  where employee_one_id = least(auth.uid(), p_employee)
    and employee_two_id = greatest(auth.uid(), p_employee);

  if not found then raise exception 'not_connected'; end if;
end;
$$;

-- Marks one notification read, or all of the caller's when p_notification is null.
create function public.mark_notifications_read(p_notification uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set is_read = true
  where recipient_id = auth.uid()
    and not is_read
    and (p_notification is null or id = p_notification);
$$;

-- ---------------------------------------------------------------------------
-- Function permissions. Supabase grants new functions to anon by default.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.connection_state(uuid)',
    'public.search_employees(text, text, text, integer, integer)',
    'public.get_employee(uuid)',
    'public.list_connections(integer, integer)',
    'public.list_connection_requests(text, integer, integer)',
    'public.list_notifications(integer, integer)',
    'public.unread_notification_count()',
    'public.send_connection_request(uuid)',
    'public.respond_connection_request(uuid, boolean)',
    'public.cancel_connection_request(uuid)',
    'public.remove_connection(uuid)',
    'public.mark_notifications_read(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.notifications;

-- Online status uses a private Realtime channel, so only signed-in employees
-- can see or announce who is online.
create policy "Employees can read online status"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() = 'employees-online' and extension = 'presence');

create policy "Employees can announce online status"
  on realtime.messages for insert
  to authenticated
  with check (realtime.topic() = 'employees-online' and extension = 'presence');
