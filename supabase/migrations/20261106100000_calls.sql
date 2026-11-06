-- KNS Chit-Chat: one-to-one calls.
--
-- Audio and video travel directly between the two browsers, encrypted by WebRTC.
-- Nothing here stores or records them. This table holds only who called whom, when,
-- and how it ended. Browsers can read their own calls but change them only through
-- the functions below, which take the caller's identity from auth.uid().
--
-- Connection setup messages use a private Realtime channel for each call, open only
-- to its two participants, and are never saved.

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id uuid references public.profiles (id) on delete set null,
  callee_id uuid references public.profiles (id) on delete set null,
  call_type text not null check (call_type in ('audio', 'video')),
  -- calling:  placed, the other person's app hasn't responded yet
  -- ringing:  the other person's app is ringing
  -- accepted: answered, the browsers are connecting
  -- connected: audio is flowing
  -- the rest are final
  status text not null default 'calling' check (status in (
    'calling', 'ringing', 'accepted', 'connected',
    'rejected', 'missed', 'cancelled', 'ended'
  )),
  answered_device uuid,
  answered_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  end_reason text check (char_length(end_reason) <= 40),
  caller_heartbeat_at timestamptz,
  callee_heartbeat_at timestamptz,
  created_at timestamptz not null default now()
);

create index calls_caller_active_idx on public.calls (caller_id) where ended_at is null;
create index calls_callee_active_idx on public.calls (callee_id) where ended_at is null;
create index calls_conversation_idx on public.calls (conversation_id, created_at desc);

alter table public.calls enable row level security;

create policy "Only the two participants can see a call"
  on public.calls for select
  to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));

revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;

-- Call entries in the chat, and a notification for calls that weren't answered.
alter table public.messages drop constraint messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check (message_type in ('text', 'file', 'call'));

alter table public.notifications drop constraint notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check
  check (notification_type in (
    'connection_request', 'connection_accepted', 'new_message',
    'channel_invitation', 'channel_message', 'channel_removed',
    'group_added', 'group_message', 'group_removed',
    'missed_call'
  ));

-- Opening the chat clears its missed-call notification too.
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
    and notification_type in ('new_message', 'group_message', 'group_added', 'missed_call')
    and reference_id = p_conversation
    and not is_read;
$$;

-- ---------------------------------------------------------------------------
-- Ending a call: the single place that sets a final status, writes the chat entry
-- and sends the missed-call notification.
-- ---------------------------------------------------------------------------
create function private.format_call_duration(p_seconds integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_seconds < 60 then p_seconds || ' sec'
    when p_seconds < 3600 then (p_seconds / 60) || ' min ' || (p_seconds % 60) || ' sec'
    else (p_seconds / 3600) || ' hr ' || ((p_seconds % 3600) / 60) || ' min'
  end;
$$;

create function private.finish_call(p_call uuid, p_status text, p_ended_by uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls;
  v_label text;
  v_text text;
  v_message public.messages;
begin
  update public.calls
  set status = p_status, ended_at = now(), ended_by = p_ended_by, end_reason = p_reason
  where id = p_call and ended_at is null
  returning * into v_call;

  -- Already over: both people ending at the same moment is normal.
  if not found then return; end if;

  v_label := v_call.call_type;

  v_text := case
    when v_call.status = 'missed' then 'Missed ' || v_label || ' call'
    when v_call.status = 'rejected' then 'Declined ' || v_label || ' call'
    when v_call.status = 'cancelled' then 'Cancelled ' || v_label || ' call'
    when v_call.connected_at is null then initcap(v_label) || ' call didn''t connect'
    else initcap(v_label) || ' call · ' || private.format_call_duration(
      greatest(extract(epoch from (v_call.ended_at - v_call.connected_at))::integer, 0)
    )
  end;

  insert into public.messages (conversation_id, sender_id, content, message_type)
  values (v_call.conversation_id, v_call.caller_id, v_text, 'call')
  returning * into v_message;

  update public.conversations set last_message_at = v_message.created_at where id = v_call.conversation_id;

  -- Only an unanswered call stays unread for the person who didn't pick up.
  update public.conversation_members
  set last_read_at = v_message.created_at
  where conversation_id = v_call.conversation_id
    and (
      employee_id = v_call.caller_id
      or (employee_id = v_call.callee_id and v_call.status not in ('missed', 'cancelled'))
    );

  if v_call.status in ('missed', 'cancelled') then
    insert into public.notifications (recipient_id, actor_id, notification_type, reference_id, message)
    select v_call.callee_id, v_call.caller_id, 'missed_call', v_call.conversation_id,
      'Missed ' || v_label || ' call from ' || p.full_name
    from public.profiles p
    where p.id = v_call.caller_id
    on conflict (recipient_id, notification_type, reference_id) do update
      set is_read = false,
          created_at = now(),
          actor_id = excluded.actor_id,
          message = excluded.message;
  end if;
end;
$$;

-- Calls nobody answered, or whose browsers have gone away, can't keep someone "busy".
create function private.expire_stale_calls(p_employee_one uuid, p_employee_two uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls;
begin
  for v_call in
    select * from public.calls c
    where c.ended_at is null
      and (c.caller_id in (p_employee_one, p_employee_two) or c.callee_id in (p_employee_one, p_employee_two))
      and (
        (c.status in ('calling', 'ringing') and c.created_at < now() - interval '60 seconds')
        or (
          c.status in ('accepted', 'connected')
          and coalesce(least(c.caller_heartbeat_at, c.callee_heartbeat_at), c.answered_at) < now() - interval '60 seconds'
        )
      )
  loop
    perform private.finish_call(
      v_call.id,
      case when v_call.status in ('calling', 'ringing') then 'missed' else 'ended' end,
      null,
      'expired'
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Connection setup messages: a private channel open only to a live call's participants.
-- ---------------------------------------------------------------------------
create function public.can_signal_call(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null
    or p_topic !~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  return exists (
    select 1 from public.calls c
    where c.id = substring(p_topic from 6)::uuid
      and c.ended_at is null
      and auth.uid() in (c.caller_id, c.callee_id)
  );
end;
$$;

create policy "Call participants can receive call signals"
  on realtime.messages for select
  to authenticated
  using (extension = 'broadcast' and public.can_signal_call(realtime.topic()));

create policy "Call participants can send call signals"
  on realtime.messages for insert
  to authenticated
  with check (extension = 'broadcast' and public.can_signal_call(realtime.topic()));

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The caller's unfinished call, with the other person's name, if there is one.
create function public.get_my_active_call()
returns table (
  id uuid,
  conversation_id uuid,
  caller_id uuid,
  callee_id uuid,
  call_type text,
  status text,
  answered_device uuid,
  answered_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.conversation_id, c.caller_id, c.callee_id, c.call_type, c.status,
    c.answered_device, c.answered_at, c.connected_at, c.created_at
  from public.calls c
  where c.ended_at is null
    and auth.uid() in (c.caller_id, c.callee_id)
    and (
      (c.status in ('calling', 'ringing') and c.created_at > now() - interval '60 seconds')
      or (
        c.status in ('accepted', 'connected')
        and coalesce(least(c.caller_heartbeat_at, c.callee_heartbeat_at), c.answered_at) > now() - interval '60 seconds'
      )
    )
  order by c.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------

-- Needs an accepted connection. Returns the call; if the other person was already
-- calling the caller, the two calls become one and that call is answered instead.
create function public.start_call(p_employee uuid, p_type text default 'audio', p_device uuid default null)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_one uuid := least(v_me, p_employee);
  v_two uuid := greatest(v_me, p_employee);
  v_conversation uuid;
  v_existing public.calls;
  v_call public.calls;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if p_employee = v_me then raise exception 'cannot_call_self'; end if;
  if p_type not in ('audio', 'video') then raise exception 'call_type_invalid'; end if;
  if not private.are_connected(v_me, p_employee) then raise exception 'not_connected'; end if;

  -- Two people calling at the same moment are handled one at a time.
  perform pg_advisory_xact_lock(hashtextextended('call' || v_one::text || v_two::text, 0));
  perform private.expire_stale_calls(v_me, p_employee);

  -- They are already calling me: answer that call.
  select * into v_existing from public.calls c
  where c.ended_at is null and c.caller_id = p_employee and c.callee_id = v_me
    and c.status in ('calling', 'ringing');
  if found then
    update public.calls
    set status = 'accepted', answered_at = now(), answered_device = p_device, callee_heartbeat_at = now(), caller_heartbeat_at = now()
    where id = v_existing.id
    returning * into v_call;
    return v_call;
  end if;

  if exists (select 1 from public.calls c where c.ended_at is null and v_me in (c.caller_id, c.callee_id)) then
    raise exception 'already_in_call';
  end if;
  if exists (select 1 from public.calls c where c.ended_at is null and p_employee in (c.caller_id, c.callee_id)) then
    raise exception 'employee_busy';
  end if;

  v_conversation := public.start_direct_conversation(p_employee);

  insert into public.calls (conversation_id, caller_id, callee_id, call_type)
  values (v_conversation, v_me, p_employee, p_type)
  returning * into v_call;

  return v_call;
end;
$$;

-- The other person's app confirms it is ringing, so the caller knows they're reachable.
create function public.mark_call_ringing(p_call uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calls
  set status = 'ringing'
  where id = p_call and callee_id = auth.uid() and status = 'calling' and ended_at is null;
$$;

-- p_device identifies the browser tab, so other open tabs stop ringing.
create function public.answer_call(p_call uuid, p_device uuid default null)
returns public.calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls;
begin
  update public.calls
  set status = 'accepted', answered_at = now(), answered_device = p_device,
      callee_heartbeat_at = now(), caller_heartbeat_at = now()
  where id = p_call
    and callee_id = auth.uid()
    and status in ('calling', 'ringing')
    and ended_at is null
  returning * into v_call;

  -- The same answer whether it's over, already answered or not the caller's to answer.
  if not found then raise exception 'call_not_available'; end if;
  return v_call;
end;
$$;

create function public.reject_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.calls
    where id = p_call and callee_id = auth.uid() and status in ('calling', 'ringing') and ended_at is null
  ) then
    return;
  end if;
  perform private.finish_call(p_call, 'rejected', auth.uid(), 'rejected');
end;
$$;

-- Hanging up, for either person at any stage. p_reason says why, such as no_answer.
create function public.end_call(p_call uuid, p_reason text default 'hung_up')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls;
  v_me uuid := auth.uid();
  v_status text;
begin
  select * into v_call from public.calls
  where id = p_call and v_me in (caller_id, callee_id) and ended_at is null;
  if not found then return; end if;

  if v_call.status in ('accepted', 'connected') then
    v_status := 'ended';
  elsif v_me = v_call.caller_id then
    -- Nobody answered in time, or nobody was there to ring.
    v_status := case when p_reason in ('no_answer', 'unreachable') then 'missed' else 'cancelled' end;
  else
    v_status := 'rejected';
  end if;

  perform private.finish_call(p_call, v_status, v_me, left(coalesce(p_reason, 'hung_up'), 40));
end;
$$;

create function public.mark_call_connected(p_call uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.calls
  set status = 'connected', connected_at = coalesce(connected_at, now())
  where id = p_call
    and auth.uid() in (caller_id, callee_id)
    and status in ('accepted', 'connected')
    and ended_at is null;
$$;

-- Says this person's browser is still there. Returns false once the call is over.
create function public.call_heartbeat(p_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  update public.calls
  set caller_heartbeat_at = case when caller_id = v_me then now() else caller_heartbeat_at end,
      callee_heartbeat_at = case when callee_id = v_me then now() else callee_heartbeat_at end
  where id = p_call and v_me in (caller_id, callee_id) and ended_at is null;
  return found;
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
    'public.can_signal_call(text)',
    'public.get_my_active_call()',
    'public.start_call(uuid, text, uuid)',
    'public.mark_call_ringing(uuid)',
    'public.answer_call(uuid, uuid)',
    'public.reject_call(uuid)',
    'public.end_call(uuid, text)',
    'public.mark_call_connected(uuid)',
    'public.call_heartbeat(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime. Delivery follows the select policy above, so only participants get it.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.calls;
