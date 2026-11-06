-- KNS Chit-Chat: profile pictures.
--
-- Pictures are shown to colleagues throughout the app, and fetching a signed link
-- for every face on every list would be slow. So this bucket serves files publicly
-- by exact address. Addresses contain a random id, and only logged-in employees can
-- read them from public.profiles. Nobody can list the bucket's contents.
--
-- avatar_url holds a path in this bucket, never a web address, so a profile can't
-- be pointed at an outside server to track who looks at it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

-- p_name must be <the caller's id>/<a generated id>.
create function public.is_own_avatar_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_name ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
$$;

create policy "Employees can upload their own picture"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and public.is_own_avatar_path(name));

-- The Storage API needs to read an object in order to remove it.
create policy "Employees can see their own picture objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and public.is_own_avatar_path(name));

create policy "Employees can remove their own picture"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and public.is_own_avatar_path(name));

-- Sets or, with null, clears the caller's picture. Returns the previous path, so
-- the browser can remove the old file.
create function public.set_my_avatar(p_path text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_previous text;
begin
  if v_me is null then raise exception 'not_authenticated'; end if;

  if p_path is not null then
    if not public.is_own_avatar_path(p_path) then raise exception 'avatar_invalid'; end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path
    ) then
      raise exception 'avatar_invalid';
    end if;
  end if;

  select avatar_url into v_previous from public.profiles where id = v_me;
  update public.profiles set avatar_url = p_path where id = v_me;
  return v_previous;
end;
$$;

revoke execute on function public.is_own_avatar_path(text) from public, anon;
grant execute on function public.is_own_avatar_path(text) to authenticated;
revoke execute on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
