-- Designations become a catalogue instead of free text.
--
-- 20261002120000 put a `designation` text column on public.users, on the argument
-- that a job title is not the role enum and not the org chart post. That argument
-- still holds and the column did its job, but it left the title as something each
-- person typed for themselves: twelve people typing "Quality Chemist" produce four
-- spellings of it, and nothing can be asked of the result. You cannot answer "who
-- can see the finance pages" from a text column, and you cannot offer a picker.
--
-- So a designation becomes a row in public.designations and public.users points at
-- it. The permission role stays exactly where it was: role is what the code and the
-- RLS policies switch on, designation is what the person is called. Two separate
-- questions, two separate columns, and the one that used to be tangled up with both
-- of them is now the one thing that is a reference.
--
-- One decision here is a security decision, and it is the reason the column moves
-- rather than being kept alongside.
--
--   private.handle_new_user() currently reads a designation out of
--   raw_user_meta_data on signup, because that is where the other profile fields
--   come from. Once a designation decides which pages a person may open -- which is
--   what 20261003110000 does -- that line becomes a self-service grant: anybody who
--   can reach the signup endpoint could put "Director" in the metadata and arrive
--   holding Director's permissions. The role has always been the constrained thing
--   here, because it is an enum, so an unknown string falls back to sales_rep. A
--   designation has no such floor, because every row in the table is a legitimate
--   designation.
--
--   So the trigger no longer reads a designation at all. A signup arrives with no
--   designation and therefore no permissions, and an admin assigns one afterwards.
--   That is the correct shape for a field that grants access: it is set by somebody
--   who already has access, never by the person asking for it.
--
-- The free-text column is dropped rather than left in place as a mirror. A mirror
-- is a second answer to "what is this person's title", and the two would drift the
-- first time a designation was renamed, because renaming a catalogue row updates one
-- row in users and leaves the other thirty copies saying the old name. The three
-- views that exposed the column keep exposing it, under the same name, sourced from
-- the join -- so no reader of a view notices, and stage22's assertions about what
-- those views carry keep meaning what they meant.

-- ---------------------------------------------------------------------------
-- 1. The catalogue
-- ---------------------------------------------------------------------------

create table public.designations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint designations_name_unique unique (name),
  constraint designations_name_not_blank check (char_length(trim(name)) > 0),
  constraint designations_name_length check (char_length(name) <= 120),
  constraint designations_description_length check (description is null or char_length(description) <= 240)
);

comment on table public.designations is
  'The catalogue of job titles. One row per title a person can hold: CEO, Director, Partner, Quality Chemist. A person points at one through public.users.designation_id. Deliberately not the permission role: role is what the policies switch on, designation is what the person is called. Renamed rather than deleted when the wording changes, because people are attached to the row.';

create index designations_active_order_idx on public.designations (is_active, sort_order, name);

create trigger designations_set_updated_at
  before update on public.designations
  for each row
  execute function public.set_updated_at();

alter table public.designations enable row level security;

-- Readable by anybody signed in. A list of job titles is not sensitive, and the
-- alternative -- gating it on the internal roles -- would make the picker on the
-- org chart render empty for a sales login that legitimately needs to see who it
-- reports to. Writes are not granted here at all; they go through the admin_*
-- functions below, which is the same rule org_positions follows.
drop policy if exists designations_read_authenticated on public.designations;
create policy designations_read_authenticated
  on public.designations
  for select
  to authenticated
  using (true);

revoke all on table public.designations from anon;
revoke all on table public.designations from authenticated;
grant select on table public.designations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The reference on the person
-- ---------------------------------------------------------------------------

alter table public.users
  add column designation_id uuid references public.designations (id) on delete set null;

comment on column public.users.designation_id is
  'Which catalogue entry this person holds. Null means nobody has assigned one, which is different from an empty title and is why it is null rather than blank. Never written by a signup: once a designation carries permissions, letting the account-holder name its own would be a self-service grant.';

create index users_designation_id_idx on public.users (designation_id);

-- Backfill from the free text before it goes, so no person loses the title they
-- already had. on conflict because two people who typed the same thing produce one
-- row, which is the point of the change.
insert into public.designations (name)
select distinct btrim(u.designation)
from public.users as u
where u.designation is not null
  and btrim(u.designation) <> ''
on conflict (name) do nothing;

update public.users as u
set designation_id = d.id
from public.designations as d
where u.designation is not null
  and btrim(u.designation) <> ''
  and d.name = btrim(u.designation);

-- The three the business names in its own words. Seeded because a brand new install
-- would otherwise open the "add a person" form with an empty designation picker and
-- no way to record that the top of the chart is a partner. on conflict keeps this
-- migration re-runnable and keeps an operator's own "CEO" row from being replaced.
insert into public.designations (name, description, sort_order)
values
  ('CEO', 'Head of the company. Reports to nobody.', 10),
  ('Director', 'Company director. May report to the CEO or stand alongside one.', 20),
  ('Partner', 'Partner of the firm. May report to the CEO or stand alongside one.', 30)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The reads, rebuilt against the join
--
-- Dropped top down and rebuilt bottom up for the reason 20261002120000 gives: the
-- view depends on the function, and the function's return type changed, and there
-- is no CREATE OR REPLACE that widens a RETURNS TABLE.
--
-- The output column is still called `designation` and is still text. That is not an
-- accident of naming: every reader of these three views is a screen that wants a
-- title to draw, and none of them wants an id. The id is available on user_directory
-- for the admin form that has to write it back.
-- ---------------------------------------------------------------------------

drop view if exists public.user_directory;
drop view if exists public.org_chart;
drop view if exists public.org_staff_roster;
drop function if exists private.org_staff_roster();
drop function if exists private.org_person(uuid);

create or replace function private.org_person(target_user_id uuid)
returns table (
  full_name text,
  email text,
  role public.user_role,
  designation text,
  designation_id uuid,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name, u.email, u.role, d.name, u.designation_id, u.is_active
  from public.users as u
  left join public.designations as d on d.id = u.designation_id
  where u.id = target_user_id
    and u.role <> 'dealer'
    and private.is_internal_staff()
$$;

comment on function private.org_person(uuid) is
  'Name, email, role, designation title, designation id and active flag for one person on the org chart, read past the users RLS that hides every other row from internal staff. One row, or none: no row when the caller is not internal staff, and none for a dealer login, which is a customer account rather than an employee.';

create or replace function private.org_staff_roster()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.user_role,
  designation text,
  designation_id uuid,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, person.full_name, person.email, person.role, person.designation, person.designation_id, person.is_active
  from public.users as u
  cross join lateral private.org_person(u.id) as person
$$;

comment on function private.org_staff_roster() is
  'Every employee account, active or suspended, for the org chart pickers. Excludes dealer logins and everything the caller is not entitled to see.';

create view public.org_chart
with (security_invoker = true)
as
select
  p.id,
  p.title,
  p.parent_id,
  p.sort_order,
  p.user_id,
  person.full_name as user_full_name,
  person.email as user_email,
  person.role as user_role,
  person.designation as user_designation,
  person.designation_id as user_designation_id,
  person.is_active as user_is_active
from public.org_positions as p
left join lateral private.org_person(p.user_id) as person on true;

comment on view public.org_chart is
  'The org chart as the screen reads it: every post with its parent, its order among its siblings, the person on it, and their designation. security_invoker, so only internal staff can read it.';

create view public.org_staff_roster
with (security_invoker = true)
as
select r.user_id, r.full_name, r.email, r.role, r.designation, r.designation_id, r.is_active
from private.org_staff_roster() as r;

comment on view public.org_staff_roster is
  'Every employee account for the org chart pickers, including suspended ones, and excluding dealer logins. security_invoker over private.org_staff_roster, so a reader who is not internal staff gets no rows rather than the whole company.';

create view public.user_directory
with (security_invoker = true)
as
select
  u.id as user_id,
  u.full_name,
  u.email,
  u.role,
  u.is_active,
  u.dealer_id,
  u.designation_id,
  d.name as designation,
  u.phone,
  dealer.name as dealer_name,
  h.manager_id,
  m.full_name as manager_name,
  m.role as manager_role
from public.users as u
left join public.designations as d on d.id = u.designation_id
left join public.dealers as dealer on dealer.id = u.dealer_id
left join public.user_hierarchy as h on h.user_id = u.id
left join public.users as m on m.id = h.manager_id;

comment on view public.user_directory is
  'Every user with their designation, phone, dealer and manager, for the admin screen. security_invoker so the existing users and user_hierarchy policies still decide who sees a row: an admin sees everyone, a manager sees their own reps.';

revoke all on table public.user_directory from public, anon, authenticated;
grant select on table public.user_directory to authenticated;
revoke all on table public.org_chart from public, anon, authenticated;
grant select on table public.org_chart to authenticated;
revoke all on table public.org_staff_roster from public, anon, authenticated;
grant select on table public.org_staff_roster to authenticated;

-- The free text goes last, once nothing in the schema is reading it.
alter table public.users drop column designation;

-- ---------------------------------------------------------------------------
-- 4. private.handle_new_user(), without the self-service designation
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text;
begin
  requested_role := new.raw_app_meta_data ->> 'role';

  -- No designation is read from the metadata, and that is the security property of
  -- this version rather than an omission. A designation decides what a person may
  -- open, so letting a signup name its own would let anybody with a network
  -- connection grant themselves Director. It arrives null and an admin sets it.
  insert into public.users (id, full_name, email, role, designation_id, is_active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New user'
    ),
    coalesce(new.email, 'unknown-' || new.id::text),
    case
      when requested_role in (
        'admin',
        'production_manager',
        'inventory_manager',
        'qc_staff',
        'sales_rep',
        'sales_manager',
        'sales_director',
        'logistics',
        'finance',
        'dealer'
      ) then requested_role::public.user_role
      else 'sales_rep'::public.user_role
    end,
    null,
    true
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email;

  return new;
end;
$$;

comment on function private.handle_new_user() is
  'AFTER INSERT on auth.users, writing the public.users profile row. qc_staff is in the role whitelist, which it was not before 20261002120000. The designation is deliberately NOT read from raw_user_meta_data: once a designation carries permissions, a signup naming its own would be a self-service grant. It is always null here, and an admin assigns it.';

-- ---------------------------------------------------------------------------
-- 5. admin_upsert_user_profile, with the reference
--
-- Dropped and recreated rather than added as an overload. Postgres would keep both
-- signatures and PostgREST would then have to choose between them on every call:
-- two functions of one name whose argument names are a superset of one another is a
-- question with two answers.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, text, text);

create function public.admin_upsert_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_is_active boolean,
  p_dealer_id uuid default null,
  p_manager_id uuid default null,
  p_designation_id uuid default null,
  p_phone text default null
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_row public.users%rowtype;
  saved_row public.users%rowtype;
  v_name text := nullif(trim(p_full_name), '');
  v_phone text := nullif(trim(p_phone), '');
  active_admins integer;
  new_active boolean;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a user, a role or the reporting hierarchy';
  end if;

  select * into target_row from public.users where id = p_user_id;

  if target_row.id is null then
    raise exception 'No user with that id. Use admin_create_user_account to make an account, or this function to change one that already exists.';
  end if;

  if v_name is null then
    raise exception 'A user needs a full name';
  end if;

  if p_designation_id is not null and not exists (
    select 1 from public.designations as d where d.id = p_designation_id
  ) then
    raise exception 'No designation with that id';
  end if;

  if v_phone is not null and char_length(v_phone) > 32 then
    raise exception 'That phone number is too long. 32 characters is the limit.';
  end if;

  -- Lockout guards. An admin who edits their own role away from admin, or
  -- suspends themselves, leaves nobody able to undo it, because every function in
  -- this migration requires the admin role.
  if target_row.id = actor_id
    and (p_role is distinct from 'admin' or coalesce(p_is_active, target_row.is_active) is not true) then
    raise exception
      'An admin cannot change their own role or suspend themselves. Ask another admin to do it.';
  end if;

  if target_row.role = 'admin'
    and target_row.is_active
    and (p_role <> 'admin' or coalesce(p_is_active, target_row.is_active) is not true) then
    select count(*) into active_admins
    from public.users as u
    where u.role = 'admin' and u.is_active;

    if active_admins <= 1 then
      raise exception 'The last active admin cannot be demoted or suspended';
    end if;
  end if;

  -- The other side of the same lockout: an admin could demote or suspend a manager
  -- while two reps still reported to them, and the only evidence would be an empty
  -- page for those two reps. Move the reports first.
  new_active := coalesce(p_is_active, target_row.is_active);

  if exists (
    select 1
    from public.user_hierarchy as h
    join public.users as child on child.id = h.user_id
    where h.manager_id = p_user_id
      and child.is_active
      and (
        (child.role = 'sales_rep' and (p_role <> 'sales_manager' or new_active is not true))
        or (child.role = 'sales_manager' and (p_role <> 'sales_director' or new_active is not true))
      )
  ) then
    raise exception
      'Active accounts still report to this one. Move them to another manager first.';
  end if;

  -- A dealer login is meaningless without the dealer it logs in as, and a staff
  -- login carrying a dealer_id would be able to read that dealer's data through
  -- the dealer policies.
  if p_role = 'dealer' and p_dealer_id is null then
    raise exception 'A dealer account must be linked to a dealer';
  end if;

  if p_role <> 'dealer' and p_dealer_id is not null then
    raise exception 'Only a dealer account can be linked to a dealer';
  end if;

  if p_dealer_id is not null and not exists (
    select 1 from public.dealers as d where d.id = p_dealer_id
  ) then
    raise exception 'No dealer with that id';
  end if;

  -- The hierarchy is three levels deep by design, so the parent of each role is
  -- fixed rather than free.
  if p_role = 'sales_rep' then
    if p_manager_id is null then
      raise exception 'A sales rep must report to a sales manager';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_manager' and m.is_active
    ) then
      raise exception 'A sales rep reports to an active sales manager';
    end if;
  elsif p_role = 'sales_manager' then
    if p_manager_id is null then
      raise exception 'A sales manager must report to the sales director';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_director' and m.is_active
    ) then
      raise exception 'A sales manager reports to the active sales director';
    end if;
  elsif p_manager_id is not null then
    raise exception 'Only sales roles report to a manager';
  end if;

  update public.users
     set full_name = v_name,
         role = p_role,
         is_active = new_active,
         dealer_id = p_dealer_id,
         designation_id = p_designation_id,
         phone = v_phone
   where id = p_user_id
  returning * into saved_row;

  if p_manager_id is null then
    delete from public.user_hierarchy where user_id = p_user_id;
  else
    insert into public.user_hierarchy (user_id, manager_id)
    values (p_user_id, p_manager_id)
    on conflict (user_id)
    do update set manager_id = excluded.manager_id;
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, uuid, text) is
  'Change a user''s name, designation, phone, role, active flag, dealer link and reporting line in one call, so the profile and the hierarchy cannot disagree. Admin only. The designation is a reference to public.designations rather than free text, and a null one clears it. Two lockout guards are deliberate: an admin may not edit their own role or suspend themselves, and the last active admin may not be demoted or suspended. A third refuses to demote or suspend an account that active accounts still report to, so the reporting line cannot be broken from the manager end. A null designation clears it, which is the opposite of how a null manager behaves: a manager is only dropped by omitting it from a role that has one.';

-- ---------------------------------------------------------------------------
-- 6. admin_create_user_account, with the reference
-- ---------------------------------------------------------------------------

drop function if exists public.admin_create_user_account(text, text, text, public.user_role, text, text, boolean, uuid, uuid);

create function public.admin_create_user_account(
  p_email text,
  p_full_name text,
  p_password text,
  p_role public.user_role,
  p_designation_id uuid default null,
  p_phone text default null,
  p_is_active boolean default true,
  p_manager_id uuid default null,
  p_dealer_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_email text := lower(nullif(trim(p_email), ''));
  v_name text := nullif(trim(p_full_name), '');
  v_designation text;
  v_phone text := nullif(trim(p_phone), '');
  v_active boolean := coalesce(p_is_active, true);
  saved_row public.users%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can create an account';
  end if;

  if v_email is null then
    raise exception 'A login needs an email address';
  end if;

  -- Deliberately loose. The point is to catch a paste that lost its @ on the way
  -- through a spreadsheet, not to adjudicate RFC 5322: an address this strict
  -- refuses is an address the vendor would have accepted and the person could not
  -- receive mail at.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address';
  end if;

  if v_name is null then
    raise exception 'A user needs a full name';
  end if;

  if p_designation_id is not null and not exists (
    select 1 from public.designations as d where d.id = p_designation_id
  ) then
    raise exception 'No designation with that id';
  end if;

  -- Carried into the auth metadata as the title text rather than the id, because
  -- raw_user_meta_data is what a vendor's own admin screen displays and an id in a
  -- title field helps nobody. It is not read back on signup: see
  -- private.handle_new_user(), which ignores it deliberately.
  select d.name into v_designation
  from public.designations as d
  where d.id = p_designation_id;

  if v_phone is not null and char_length(v_phone) > 32 then
    raise exception 'That phone number is too long. 32 characters is the limit.';
  end if;

  if p_password is null or char_length(p_password) < 8 then
    raise exception 'The initial password needs at least 8 characters';
  end if;

  if btrim(p_password) = '' then
    raise exception 'The password cannot be only spaces';
  end if;

  -- Checked before the write so the message is the useful one, and relied on
  -- afterwards only for the race: the partial unique index on auth.users(email) is
  -- what actually stops two admins creating the same login at the same moment, and
  -- the handler below turns that into the same sentence.
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with that email address already exists';
  end if;

  if p_role = 'dealer' and p_dealer_id is null then
    raise exception 'A dealer account must be linked to a dealer';
  end if;

  if p_role <> 'dealer' and p_dealer_id is not null then
    raise exception 'Only a dealer account can be linked to a dealer';
  end if;

  if p_dealer_id is not null and not exists (
    select 1 from public.dealers as d where d.id = p_dealer_id
  ) then
    raise exception 'No dealer with that id';
  end if;

  if p_role = 'sales_rep' then
    if p_manager_id is null then
      raise exception 'A sales rep must report to a sales manager';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_manager' and m.is_active
    ) then
      raise exception 'A sales rep reports to an active sales manager';
    end if;
  elsif p_role = 'sales_manager' then
    if p_manager_id is null then
      raise exception 'A sales manager must report to the sales director';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_director' and m.is_active
    ) then
      raise exception 'A sales manager reports to the active sales director';
    end if;
  elsif p_manager_id is not null then
    raise exception 'Only sales roles report to a manager';
  end if;

  begin
    -- email is supplied here because on this version of GoTrue it has no default;
    -- see the header of 20261002120000. instance_id, aud and role are the three
    -- values every seeded account in this database carries.
    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_sent_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf', 6)),
      timezone('utc', now()),
      timezone('utc', now()),
      jsonb_build_object(
        'provider', 'email',
        'providers', jsonb_build_array('email'),
        'role', p_role::text
      ),
      jsonb_build_object(
        'email', v_email,
        'full_name', v_name,
        'designation', v_designation
      ),
      timezone('utc', now()),
      timezone('utc', now())
    );
  exception
    when unique_violation then
      raise exception 'An account with that email address already exists';
  end;

  -- email is deliberately absent from this column list: on this version it is a
  -- stored generated column over identity_data, and naming it is an error rather
  -- than a redundant value.
  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    v_user_id::text,
    v_user_id,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    timezone('utc', now()),
    timezone('utc', now()),
    timezone('utc', now())
  );

  -- An upsert, not an insert, because private.handle_new_user() has already written
  -- this row from the trigger above. Its role whitelist was repaired in
  -- 20261002120000, but relying on that would make this function's correctness
  -- depend on the state of somebody else's trigger, so the role is written here as
  -- well.
  insert into public.users (id, full_name, email, role, designation_id, phone, is_active, dealer_id)
  values (v_user_id, v_name, v_email, p_role, p_designation_id, v_phone, v_active, p_dealer_id)
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        designation_id = excluded.designation_id,
        phone = excluded.phone,
        is_active = excluded.is_active,
        dealer_id = excluded.dealer_id
  returning * into saved_row;

  if p_manager_id is not null then
    insert into public.user_hierarchy (user_id, manager_id)
    values (v_user_id, p_manager_id)
    on conflict (user_id)
    do update set manager_id = excluded.manager_id;
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid) is
  'Create one login end to end: the auth row, the identity row a password sign-in needs, the profile, and the reporting line. Admin only. This replaces provisioning that had to happen out of band, and it is a SECURITY DEFINER function writing auth.*, so the admin check is the only thing between a request and a new account. The designation is a reference to public.designations. Every argument is validated before the first write, and the whole call is one transaction, so a refusal cannot leave an auth row without a profile. The password is hashed with the bcrypt parameters GoTrue itself uses and is not recoverable afterwards. Refuses a duplicate email, a weak password, a dealer account with no dealer, and a reporting line the three-level hierarchy does not allow.';

-- ---------------------------------------------------------------------------
-- 7. admin_upsert_designation / admin_delete_designation
--
-- The catalogue is written from the org chart page and nowhere else. Same shape as
-- every other admin_ function in this project: SECURITY DEFINER, role checked
-- inside the database, no table grant behind it.
--
-- A designation with people attached is a designation somebody is called at work, so
-- delete refuses while anybody holds it rather than dropping every one of them back
-- to no title. is_active is the softer exit for a title that has fallen out of use but
-- that past holders should keep on their card: it takes the row out of the picker
-- without touching the people.
-- ---------------------------------------------------------------------------

create function public.admin_upsert_designation(
  p_name text,
  p_description text default null,
  p_sort_order integer default null,
  p_designation_id uuid default null
)
returns public.designations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_description text := nullif(trim(p_description), '');
  saved_row public.designations%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a designation';
  end if;

  if v_name is null then
    raise exception 'A designation needs a name';
  end if;

  if char_length(v_name) > 120 then
    raise exception 'That designation name is too long. 120 characters is the limit.';
  end if;

  if v_description is not null and char_length(v_description) > 240 then
    raise exception 'That description is too long. 240 characters is the limit.';
  end if;

  if p_designation_id is null then
    if exists (select 1 from public.designations where lower(name) = lower(v_name)) then
      raise exception 'A designation called that already exists';
    end if;

    insert into public.designations (name, description, sort_order, is_active)
    values (v_name, v_description, coalesce(p_sort_order, 0), true)
    returning * into saved_row;

    return saved_row;
  end if;

  -- Checked before the update for the same reason it is on the create path: the
  -- message an operator gets matters more here than the constraint's, and two
  -- spellings of one title is the problem this table exists to remove.
  if exists (
    select 1 from public.designations
     where lower(name) = lower(v_name) and id <> p_designation_id
  ) then
    raise exception 'A designation called that already exists';
  end if;

  update public.designations
     set name = v_name,
         description = v_description,
         sort_order = coalesce(p_sort_order, sort_order),
         is_active = true
   where id = p_designation_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No designation with that id';
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_upsert_designation(text, text, integer, uuid) is
  'Create or rename one entry in the designation catalogue. Admin only. A rename is an update and not a delete-and-recreate, because people point at the row: replacing it would drop every holder of it back to no title. Creating a name that already exists is refused rather than silently reusing the row, because two spellings of one title is the problem this table exists to remove.';

create function public.admin_delete_designation(p_designation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  holders integer;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a designation';
  end if;

  if not exists (select 1 from public.designations where id = p_designation_id) then
    raise exception 'No designation with that id';
  end if;

  select count(*) into holders from public.users where designation_id = p_designation_id;

  if holders > 0 then
    raise exception
      '% people hold this designation. Move them to another one first.', holders;
  end if;

  delete from public.designations where id = p_designation_id;
end;
$$;

comment on function public.admin_delete_designation(uuid) is
  'Remove one entry from the designation catalogue. Admin only. Refused while anybody holds it, so a title cannot be deleted out from under the people who are called it.';

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------

revoke all on function private.org_person(uuid) from public;
grant execute on function private.org_person(uuid) to authenticated;
revoke all on function private.org_staff_roster() from public;
grant execute on function private.org_staff_roster() to authenticated;

revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, uuid, text) from public;
revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, uuid, text) from anon;
revoke all on function public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid) from public;
revoke all on function public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid) from anon;
revoke all on function public.admin_set_user_password(uuid, text, boolean) from public;
revoke all on function public.admin_set_user_password(uuid, text, boolean) from anon;
revoke all on function public.admin_upsert_designation(text, text, integer, uuid) from public;
revoke all on function public.admin_upsert_designation(text, text, integer, uuid) from anon;
revoke all on function public.admin_delete_designation(uuid) from public;
revoke all on function public.admin_delete_designation(uuid) from anon;

grant execute on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid) to authenticated;
grant execute on function public.admin_set_user_password(uuid, text, boolean) to authenticated;
grant execute on function public.admin_upsert_designation(text, text, integer, uuid) to authenticated;
grant execute on function public.admin_delete_designation(uuid) to authenticated;

notify pgrst, 'reload schema';