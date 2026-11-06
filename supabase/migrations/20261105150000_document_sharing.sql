-- KNS Chit-Chat, Phase 5: document sharing.
--
-- Files live in a private bucket with no public URLs. Access always follows the
-- parent conversation or channel, checked by row level security on both the
-- metadata (public.shared_files) and the stored objects (storage.objects).
--
-- An upload has two steps. The browser stores the object, then calls a share
-- function, which checks the real stored object rather than what the browser says.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-files',
  'shared-files',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg'
  ]
);

alter table public.messages drop constraint messages_message_type_check;
alter table public.messages add constraint messages_message_type_check check (message_type in ('text', 'file'));
alter table public.channel_messages drop constraint channel_messages_message_type_check;
alter table public.channel_messages add constraint channel_messages_message_type_check check (message_type in ('text', 'file'));

create table public.shared_files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid references public.profiles (id) on delete set null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0),
  conversation_id uuid references public.conversations (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  channel_message_id uuid references public.channel_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  -- Every file belongs to exactly one place.
  constraint shared_files_one_parent check (num_nonnulls(conversation_id, channel_id) = 1)
);

create index shared_files_conversation_idx on public.shared_files (conversation_id, created_at desc) where deleted_at is null;
create index shared_files_channel_idx on public.shared_files (channel_id, created_at desc) where deleted_at is null;
create index shared_files_message_idx on public.shared_files (message_id);
create index shared_files_channel_message_idx on public.shared_files (channel_message_id);

alter table public.shared_files enable row level security;

create policy "Only members of the parent can see a file"
  on public.shared_files for select
  to authenticated
  using (
    deleted_at is null
    and (
      (conversation_id is not null and public.is_conversation_member(conversation_id))
      or (channel_id is not null and public.is_channel_member(channel_id))
    )
  );

revoke all on public.shared_files from anon, authenticated;
grant select on public.shared_files to authenticated;

-- ---------------------------------------------------------------------------
-- Removing stored objects. The database decides a file should go; the browser that
-- asked then removes the object through the Storage API. If that's interrupted, the
-- entry stays here and the next visit tries again. Objects in this queue can't be read.
-- ---------------------------------------------------------------------------
create table private.file_purge_queue (
  storage_path text primary key,
  requested_by uuid,
  created_at timestamptz not null default now()
);

-- Also catches files removed by a cascade, such as when a group is deleted.
create function private.queue_file_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.file_purge_queue (storage_path, requested_by)
  values (old.storage_path, auth.uid())
  on conflict (storage_path) do nothing;
  return old;
end;
$$;

create trigger shared_files_queue_purge
  before delete on public.shared_files
  for each row execute function private.queue_file_purge();

-- ---------------------------------------------------------------------------
-- Storage rules. They only answer about the caller, so they reveal nothing else.
-- ---------------------------------------------------------------------------

-- p_name must be conversations/<id>/<id> or channels/<id>/<id>, somewhere the caller can post.
create function public.can_upload_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_uuid text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_parent uuid;
  v_type text;
  v_other uuid;
begin
  if v_me is null or p_name is null then return false; end if;

  if p_name ~ ('^conversations/' || v_uuid || '/' || v_uuid || '$') then
    v_parent := split_part(p_name, '/', 2)::uuid;
    select c.conversation_type into v_type
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id and m.employee_id = v_me
    where c.id = v_parent;
    if v_type is null then return false; end if;
    if v_type = 'group' then return true; end if;
    select employee_id into v_other from public.conversation_members
    where conversation_id = v_parent and employee_id <> v_me;
    return v_other is not null and private.are_connected(v_me, v_other);
  end if;

  if p_name ~ ('^channels/' || v_uuid || '/' || v_uuid || '$') then
    v_parent := split_part(p_name, '/', 2)::uuid;
    return private.channel_role(v_parent, v_me) is not null
      and exists (select 1 from public.channels where id = v_parent and archived_at is null);
  end if;

  return false;
end;
$$;

create function public.can_purge_file(p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- The database has marked this file for removal at the caller's request.
    exists (
      select 1 from private.file_purge_queue q
      where q.storage_path = p_name and q.requested_by = auth.uid()
    )
    -- Or the caller uploaded it and it was never shared, such as a failed upload.
    or (
      p_owner = auth.uid()::text
      and not exists (select 1 from public.shared_files f where f.storage_path = p_name)
      and not exists (select 1 from private.file_purge_queue q where q.storage_path = p_name)
    );
$$;

create function public.can_read_file(p_name text, p_owner text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.shared_files f
      where f.storage_path = p_name
        and f.deleted_at is null
        and (
          (f.conversation_id is not null and exists (
            select 1 from public.conversation_members m
            where m.conversation_id = f.conversation_id and m.employee_id = auth.uid()
          ))
          or (f.channel_id is not null and private.channel_role(f.channel_id, auth.uid()) is not null)
        )
    )
    -- The Storage API also needs to read an object in order to remove it.
    or public.can_purge_file(p_name, p_owner);
$$;

create policy "Members can upload shared files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'shared-files' and public.can_upload_file(name));

create policy "Members can read shared files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'shared-files' and public.can_read_file(name, owner_id));

create policy "Authorised removal of shared files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'shared-files' and public.can_purge_file(name, owner_id));

-- ---------------------------------------------------------------------------
-- Checking an upload against what was really stored
-- ---------------------------------------------------------------------------
create function private.allowed_mime_types(p_extension text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_extension
    when 'pdf' then array['application/pdf']
    when 'doc' then array['application/msword']
    when 'docx' then array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    when 'xls' then array['application/vnd.ms-excel']
    when 'xlsx' then array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    when 'ppt' then array['application/vnd.ms-powerpoint']
    when 'pptx' then array['application/vnd.openxmlformats-officedocument.presentationml.presentation']
    when 'txt' then array['text/plain']
    when 'csv' then array['text/csv']
    when 'png' then array['image/png']
    when 'jpg' then array['image/jpeg']
    when 'jpeg' then array['image/jpeg']
  end;
$$;

create function private.check_uploaded_file(
  p_path text,
  p_prefix text,
  p_file_name text,
  out file_name text,
  out mime_type text,
  out file_size bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uuid text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_metadata jsonb;
  v_limit bigint;
  v_allowed text[];
begin
  if p_path is null or p_path !~ ('^' || p_prefix || '/' || v_uuid || '$') then
    raise exception 'file_invalid_path';
  end if;

  select o.metadata into v_metadata from storage.objects o
  where o.bucket_id = 'shared-files' and o.name = p_path and o.owner_id = auth.uid()::text;
  if not found then raise exception 'file_not_uploaded'; end if;

  if exists (select 1 from public.shared_files f where f.storage_path = p_path) then
    raise exception 'file_already_shared';
  end if;

  file_name := btrim(coalesce(p_file_name, ''));
  if char_length(file_name) not between 1 and 255 or file_name ~ '[/\\[:cntrl:]]' then
    raise exception 'file_name_invalid';
  end if;

  -- The name, the stored type and the size all come under the same rules.
  mime_type := v_metadata ->> 'mimetype';
  file_size := (v_metadata ->> 'size')::bigint;
  v_allowed := private.allowed_mime_types(lower(substring(file_name from '\.([^.]+)$')));
  if v_allowed is null or mime_type is null or not (mime_type = any (v_allowed)) then
    raise exception 'file_type_not_allowed';
  end if;

  select b.file_size_limit into v_limit from storage.buckets b where b.id = 'shared-files';
  if file_size is null or file_size > v_limit then raise exception 'file_too_large'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads. These run as the caller, so row level security still applies.
-- ---------------------------------------------------------------------------

-- All files the caller can see, or those of one place, or of particular messages.
-- p_kind: image or document.
create function public.list_shared_files(
  p_search text default null,
  p_kind text default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_conversation uuid default null,
  p_channel uuid default null,
  p_message_ids uuid[] default null,
  p_channel_message_ids uuid[] default null
)
returns table (
  id uuid,
  file_name text,
  storage_path text,
  mime_type text,
  file_size bigint,
  created_at timestamptz,
  uploader_id uuid,
  uploader_name text,
  conversation_id uuid,
  channel_id uuid,
  message_id uuid,
  channel_message_id uuid,
  location_type text,
  location_name text,
  can_delete boolean
)
language sql
stable
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' as value
  )
  select f.id, f.file_name, f.storage_path, f.mime_type, f.file_size, f.created_at,
    f.uploader_id, uploader.full_name, f.conversation_id, f.channel_id, f.message_id, f.channel_message_id,
    case when f.channel_id is not null then 'channel' else c.conversation_type end,
    case
      when f.channel_id is not null then ch.name
      when c.conversation_type = 'group' then c.name
      else (
        select p.full_name from public.conversation_members other
        join public.profiles p on p.id = other.employee_id
        where other.conversation_id = f.conversation_id and other.employee_id <> auth.uid()
        limit 1
      )
    end,
    case
      when ch.archived_at is not null then false
      when f.uploader_id = auth.uid() then true
      when f.channel_id is not null then channel_me.role in ('owner', 'admin') and channel_me.membership_status = 'active'
      when c.conversation_type = 'group' then conversation_me.role in ('owner', 'admin')
      else false
    end
  from public.shared_files f
  cross join pattern
  left join public.profiles uploader on uploader.id = f.uploader_id
  left join public.conversations c on c.id = f.conversation_id
  left join public.conversation_members conversation_me
    on conversation_me.conversation_id = f.conversation_id and conversation_me.employee_id = auth.uid()
  left join public.channels ch on ch.id = f.channel_id
  left join public.channel_members channel_me
    on channel_me.channel_id = f.channel_id and channel_me.employee_id = auth.uid()
  where (p_conversation is null or f.conversation_id = p_conversation)
    and (p_channel is null or f.channel_id = p_channel)
    and (p_message_ids is null or f.message_id = any (p_message_ids))
    and (p_channel_message_ids is null or f.channel_message_id = any (p_channel_message_ids))
    and (nullif(btrim(p_search), '') is null or f.file_name ilike pattern.value)
    and (
      p_kind is null
      or (p_kind = 'image' and f.mime_type like 'image/%')
      or (p_kind = 'document' and f.mime_type not like 'image/%')
    )
  order by f.created_at desc, f.id desc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- ---------------------------------------------------------------------------
-- Changes
-- ---------------------------------------------------------------------------
create function public.share_conversation_file(
  p_conversation uuid,
  p_path text,
  p_file_name text,
  p_client_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conversation public.conversations;
  v_other uuid;
  v_file record;
  v_message public.messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  select c.* into v_conversation
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id and m.employee_id = v_me
  where c.id = p_conversation;
  if not found then raise exception 'conversation_not_found'; end if;

  if v_conversation.conversation_type = 'direct' then
    select employee_id into v_other from public.conversation_members
    where conversation_id = p_conversation and employee_id <> v_me;
    if v_other is null or not private.are_connected(v_me, v_other) then
      raise exception 'not_connected';
    end if;
  end if;

  -- A retry of a share that already went through returns the original.
  if p_client_id is not null then
    select * into v_message from public.messages where sender_id = v_me and client_id = p_client_id;
    if found then return v_message; end if;
  end if;

  select * into v_file from private.check_uploaded_file(p_path, 'conversations/' || p_conversation::text, p_file_name);

  insert into public.messages (conversation_id, sender_id, content, message_type, client_id)
  values (p_conversation, v_me, v_file.file_name, 'file', p_client_id)
  returning * into v_message;

  insert into public.shared_files (uploader_id, file_name, storage_path, mime_type, file_size, conversation_id, message_id)
  values (v_me, v_file.file_name, p_path, v_file.mime_type, v_file.file_size, p_conversation, v_message.id);

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

create function public.share_channel_file(
  p_channel uuid,
  p_path text,
  p_file_name text,
  p_client_id uuid default null
)
returns public.channel_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_file record;
  v_message public.channel_messages;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;
  if private.channel_role(p_channel, v_me) is null then raise exception 'channel_not_found'; end if;
  perform private.require_not_archived(p_channel);

  if p_client_id is not null then
    select * into v_message from public.channel_messages where sender_id = v_me and client_id = p_client_id;
    if found then return v_message; end if;
  end if;

  select * into v_file from private.check_uploaded_file(p_path, 'channels/' || p_channel::text, p_file_name);

  insert into public.channel_messages (channel_id, sender_id, content, message_type, client_id)
  values (p_channel, v_me, v_file.file_name, 'file', p_client_id)
  returning * into v_message;

  insert into public.shared_files (uploader_id, file_name, storage_path, mime_type, file_size, channel_id, channel_message_id)
  values (v_me, v_file.file_name, p_path, v_file.mime_type, v_file.file_size, p_channel, v_message.id);

  update public.channels set last_message_at = v_message.created_at where id = p_channel returning name into v_name;
  update public.channel_members set last_read_at = v_message.created_at
  where channel_id = p_channel and employee_id = v_me;

  perform private.notify_channel_message(p_channel, v_name, v_me);
  return v_message;
end;
$$;

-- The uploader, or an owner or admin of the group or channel, while still a member.
-- The file is unreadable from this moment. The caller then removes the stored object.
create function public.delete_shared_file(p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_file public.shared_files;
  v_role text;
  v_type text;
begin
  select * into v_file from public.shared_files where id = p_file and deleted_at is null for update;
  if not found then raise exception 'file_not_found'; end if;

  if v_file.channel_id is not null then
    v_role := private.channel_role(v_file.channel_id, v_me);
    if v_role is null then raise exception 'file_not_found'; end if;
    perform private.require_not_archived(v_file.channel_id);
  else
    select m.role, c.conversation_type into v_role, v_type
    from public.conversation_members m
    join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = v_file.conversation_id and m.employee_id = v_me;
    if v_role is null then raise exception 'file_not_found'; end if;
  end if;

  if v_file.uploader_id is distinct from v_me
    and not (coalesce(v_type, 'group') = 'group' and v_role in ('owner', 'admin')) then
    raise exception 'file_delete_not_allowed';
  end if;

  update public.shared_files set deleted_at = now(), deleted_by = v_me where id = p_file;

  insert into private.file_purge_queue (storage_path, requested_by)
  values (v_file.storage_path, v_me)
  on conflict (storage_path) do update set requested_by = excluded.requested_by;

  -- The file's name goes too: it may itself be confidential.
  update public.messages set content = 'File deleted' where id = v_file.message_id;
  update public.channel_messages set content = 'File deleted' where id = v_file.channel_message_id;
end;
$$;

-- Stored objects the caller still has to remove. Finished entries are cleared here.
create function public.pending_file_purges()
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.file_purge_queue q
  where q.requested_by = auth.uid()
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'shared-files' and o.name = q.storage_path
    );

  return query
    select q.storage_path from private.file_purge_queue q where q.requested_by = auth.uid() limit 100;
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
    'public.can_upload_file(text)',
    'public.can_read_file(text, text)',
    'public.can_purge_file(text, text)',
    'public.list_shared_files(text, text, integer, integer, uuid, uuid, uuid[], uuid[])',
    'public.share_conversation_file(uuid, text, text, uuid)',
    'public.share_channel_file(uuid, text, text, uuid)',
    'public.delete_shared_file(uuid)',
    'public.pending_file_purges()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
