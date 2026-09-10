-- SparrowFi schema.
--
-- Run this once in your Supabase project's SQL Editor (SQL Editor -> New
-- query -> paste -> Run) after creating the project.
--
-- SparrowFi has no local-file mode anymore: signing in loads your one
-- ongoing finance record straight from here, and every edit is saved back
-- here too. This does NOT use Supabase Auth - no email, no confirmation
-- links. It's a small self-contained login system: an `app_users` table
-- holding a username and a bcrypt password hash, plus a handful of
-- functions the client calls to sign up, sign in, and load/save that one
-- record. Nobody (not even with the public anon key) can query
-- `app_users` or `user_data` directly - both tables have Row Level
-- Security turned on with zero policies, so the API blocks all direct
-- access to them. The ONLY way in is through the functions below, which
-- run as SECURITY DEFINER (meaning they run with the privileges of the
-- user who created them, not the caller) and check the supplied
-- username/password themselves before touching any data.
--
-- Your data is always encrypted in the browser - with a key derived from
-- your account password - before it's sent here, using a fresh random
-- salt and IV on every save (see `cloud-data.service.ts`). Supabase only
-- ever stores ciphertext; there is no separate recovery mechanism, so
-- losing your password means losing access to this data.
--
-- This whole file is safe to re-run from scratch at any time (e.g. after
-- editing a function below) - everything it creates is dropped first, "if
-- exists", so re-running never hits an "already exists" error. Re-running
-- DOES wipe all accounts and saved data, since app_users/user_data are
-- dropped and recreated - only do this if that's what you want (e.g. a
-- clean slate while setting this up), not on a project already in use.

-- Old pre-rewrite objects (a Supabase Auth + email-based version of this
-- app, before it switched to the username/password functions below).
drop function if exists public.backup_upsert(text, text, text, text, bigint);
drop function if exists public.backup_list(text, text);
drop function if exists public.backup_restore(text, text, text);
drop table if exists public.spw_backups;

-- This file's own objects, so it can be re-run cleanly.
drop function if exists public.data_reset(text, text);
drop function if exists public.data_load(text, text);
drop function if exists public.data_save(text, text, text, text, text);
drop function if exists public.account_login(text, text);
drop function if exists public.account_create(text, text);
drop table if exists public.user_data;
drop table if exists public.app_users;

-- Needed for crypt()/gen_salt(), which do the login password hashing.
-- Supabase keeps extensions out of the public schema, hence
-- "extensions.crypt(...)" below instead of plain "crypt(...)".
create extension if not exists pgcrypto with schema extensions;

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- One row per account: your entire finance state, client-side encrypted.
-- `salt`/`iv` are per-save (regenerated every `data_save` call, not
-- secret) and needed to derive the same AES key again on load.
create table public.user_data (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  salt text not null,
  iv text not null,
  data text not null,        -- base64 AES-256-GCM ciphertext of the JSON state
  updated_at timestamptz not null default now()
);

-- RLS with no policies = nobody gets in via the REST API, at all, ever -
-- including with the anon key. All access happens through the functions
-- below instead.
alter table public.app_users enable row level security;
alter table public.user_data enable row level security;

-- Belt-and-braces: even if a future policy or default grant tried to open
-- these up, the anon/authenticated roles have no table privileges here.
revoke all on public.app_users from anon, authenticated;
revoke all on public.user_data from anon, authenticated;

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
-- first, so a wrong password never gets anywhere near your data.
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

-- Replaces the signed-in user's one saved record. `p_data` is already
-- AES-256-GCM ciphertext (base64) by the time it gets here - this
-- function never sees plaintext.
create or replace function public.data_save(
  p_username text, p_password text, p_salt text, p_iv text, p_data text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
begin
  insert into public.user_data (user_id, salt, iv, data, updated_at)
  values (v_id, p_salt, p_iv, p_data, now())
  on conflict (user_id)
  do update set salt = excluded.salt, iv = excluded.iv, data = excluded.data, updated_at = now();
end;
$$;

-- Returns the signed-in user's saved record (still encrypted - decryption
-- happens entirely client-side), or zero rows for a brand-new account
-- that hasn't saved anything yet.
create or replace function public.data_load(p_username text, p_password text)
returns table (salt text, iv text, data text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
begin
  return query
  select u.salt, u.iv, u.data, u.updated_at
  from public.user_data u
  where u.user_id = v_id;
end;
$$;

-- Wipes the signed-in user's saved record (their account itself, and its
-- username/password, are untouched - only their `user_data` row is
-- deleted). A no-op if there was nothing saved yet. The client follows
-- this up by writing a fresh empty state back with `data_save`, so the
-- account ends up back at a clean slate rather than in the "brand-new,
-- never saved" state - but this function only ever deletes, it never
-- needs to see (or create) plaintext data itself.
create or replace function public.data_reset(p_username text, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := public.account_login(p_username, p_password);
begin
  delete from public.user_data where user_id = v_id;
end;
$$;

-- The client only ever has the public anon key, so it needs explicit
-- permission to call these functions (but still can't touch the tables
-- directly - see the revokes above).
grant execute on function public.account_create(text, text) to anon;
grant execute on function public.account_login(text, text) to anon;
grant execute on function public.data_save(text, text, text, text, text) to anon;
grant execute on function public.data_load(text, text) to anon;
grant execute on function public.data_reset(text, text) to anon;
