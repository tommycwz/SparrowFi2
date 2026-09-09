-- SparrowFi Cloud Backup schema.
--
-- Run this once in your Supabase project's SQL Editor (SQL Editor -> New
-- query -> paste -> Run) after creating the project.
--
-- This does NOT use Supabase Auth at all - no email, no confirmation
-- links, none of that. It's a small self-contained login system: a
-- `app_users` table holding a username and a bcrypt password hash, plus a
-- handful of functions the client calls to sign up, sign in, and back
-- up/restore a file. Nobody (not even with the public anon key) can query
-- `app_users` or `spw_backups` directly - both tables have Row Level
-- Security turned on with zero policies, so the API blocks all direct
-- access to them. The ONLY way in is through the functions below, which
-- run as SECURITY DEFINER (meaning they run with the privileges of the
-- user who created them, not the caller) and check the supplied
-- username/password themselves before touching any data.
--
-- If you previously ran the old version of this file (the one that used
-- `auth.users` / Supabase Auth), drop that table first:
--   drop table if exists public.spw_backups;

-- Needed for crypt()/gen_salt(), which do the password hashing. Supabase
-- keeps extensions out of the public schema, hence "extensions.crypt(...)"
-- below instead of plain "crypt(...)".
create extension if not exists pgcrypto with schema extensions;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.spw_backups (
  user_id uuid not null references public.app_users(id) on delete cascade,
  filename text not null,
  data text not null,        -- base64-encoded SPW3 (password-encrypted) file bytes
  size_bytes bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, filename)
);

-- RLS with no policies = nobody gets in via the REST API, at all, ever -
-- including with the anon key. All access happens through the functions
-- below instead.
alter table public.app_users enable row level security;
alter table public.spw_backups enable row level security;

-- Belt-and-braces: even if a future policy or default grant tried to open
-- these up, the anon/authenticated roles have no table privileges here.
revoke all on public.app_users from anon, authenticated;
revoke all on public.spw_backups from anon, authenticated;

-- Creates a new account. Raises an exception (which the client shows as
-- the error message) if the username is taken or the input is too short.
create or replace function public.account_create(p_username text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(p_username));
  v_id uuid;
begin
  if length(v_username) < 3 then
    raise exception 'Username must be at least 3 characters.';
  end if;
  if v_username !~ '^[a-z0-9_.-]+$' then
    raise exception 'Username can only contain letters, numbers, and . _ -';
  end if;
  if length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;
  if exists (select 1 from public.app_users where username = v_username) then
    raise exception 'That username is already taken.';
  end if;
  insert into public.app_users (username, password_hash)
  values (v_username, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  returning id into v_id;
  return v_id;
end;
$$;

-- Verifies a username/password pair and returns the user id, or raises if
-- it doesn't match. Every other function below calls this internally
-- first, so a wrong password never gets anywhere near the backups table.
create or replace function public.account_login(p_username text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(trim(p_username));
  v_id uuid;
begin
  select id into v_id
  from public.app_users
  where username = v_username
    and password_hash = extensions.crypt(p_password, password_hash);
  if v_id is null then
    raise exception 'Wrong username or password.';
  end if;
  return v_id;
end;
$$;

create or replace function public.backup_upsert(
  p_username text, p_password text, p_filename text, p_data text, p_size bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
begin
  insert into public.spw_backups (user_id, filename, data, size_bytes, updated_at)
  values (v_id, p_filename, p_data, p_size, now())
  on conflict (user_id, filename)
  do update set data = excluded.data, size_bytes = excluded.size_bytes, updated_at = now();
end;
$$;

create or replace function public.backup_list(p_username text, p_password text)
returns table (filename text, size_bytes bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
begin
  return query
  select b.filename, b.size_bytes, b.updated_at
  from public.spw_backups b
  where b.user_id = v_id
  order by b.updated_at desc;
end;
$$;

create or replace function public.backup_restore(p_username text, p_password text, p_filename text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
  v_data text;
begin
  select data into v_data from public.spw_backups where user_id = v_id and filename = p_filename;
  if v_data is null then
    raise exception 'No backup found with that name.';
  end if;
  return v_data;
end;
$$;

-- The client only ever has the public anon key, so it needs explicit
-- permission to call these functions (but still can't touch the tables
-- directly - see the revokes above).
grant execute on function public.account_create(text, text) to anon;
grant execute on function public.account_login(text, text) to anon;
grant execute on function public.backup_upsert(text, text, text, text, bigint) to anon;
grant execute on function public.backup_list(text, text) to anon;
grant execute on function public.backup_restore(text, text, text) to anon;
