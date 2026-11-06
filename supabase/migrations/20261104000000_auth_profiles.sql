-- Orbit: user profiles and the database functions the sign-up and login flows use.
-- Rules mirror src/utils/validation.js. Keep the two in sync.

create function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username = any (array[
    'admin', 'administrator', 'root', 'system', 'support', 'help',
    'orbit', 'official', 'security', 'moderator', 'api', 'login', 'signup'
  ]);
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),

  constraint profiles_username_format check (
    username ~ '^[a-z0-9._]{3,30}$'
    and username !~ '^\.|\.$|\.\.'
  ),
  constraint profiles_username_not_reserved check (not public.is_reserved_username(username)),
  constraint profiles_full_name_length check (char_length(full_name) between 2 and 50)
);

-- Row level security: people can read only their own profile for now. Widen
-- this when features such as public profile pages need it. There is no write
-- policy, so profiles change only through the trigger below.
alter table public.profiles enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Creates the profile as part of sign-up. If this raises an error, for example
-- on a duplicate or invalid username, the whole sign-up is rolled back.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    lower(btrim(new.raw_user_meta_data ->> 'username')),
    regexp_replace(btrim(new.raw_user_meta_data ->> 'full_name'), '\s+', ' ', 'g')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Live availability checks for the sign-up form. security definer lets them
-- answer yes or no without exposing any rows.
create function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.is_reserved_username(lower(btrim(p_username)))
    and not exists (
      select 1 from public.profiles where username = lower(btrim(p_username))
    );
$$;

create function public.is_email_available(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from auth.users where lower(email) = lower(btrim(p_email))
  );
$$;

-- Used only by the login-with-username Edge Function. Browsers must not be able
-- to call this, or anyone could turn a username into a private email address.
create function public.get_email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(btrim(p_username));
$$;

-- Supabase grants execute on new functions to anon and authenticated by default,
-- so these revokes must name those roles, not only public.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.get_email_for_username(text) from public, anon, authenticated;
grant execute on function public.get_email_for_username(text) to service_role;
grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.is_email_available(text) to anon, authenticated;
