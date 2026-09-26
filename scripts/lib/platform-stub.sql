-- Minimal stand-in for the objects a Supabase project provides in every
-- database, so the migrations can be replayed into a scratch database (or a
-- plain local PostgreSQL) that does not have them.
--
-- A real Supabase project already has all of this, so this file is a no-op
-- there. It exists because two things the migrations depend on are easy to miss
-- when rebuilding from empty:
--
--   * auth.users / auth.identities / auth.uid() -- GoTrue owns these, no
--     migration creates them.
--   * USAGE on the extensions schema for anon and authenticated. The pgTAP
--     suites switch to anon mid-file and then still have to resolve pgTAP
--     functions, which live in extensions.
--
-- Everything here is idempotent.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------- extensions

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------- auth

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text,
  phone_change text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create table if not exists auth.identities (
  id uuid primary key,
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

create unique index if not exists identities_provider_id_provider_key
  on auth.identities (provider_id, provider);

-- Supabase reads the authenticated user id out of the verified JWT claim.
create or replace function auth.uid() returns uuid
  language sql
  stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- ------------------------------------------------------------------- grants

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
