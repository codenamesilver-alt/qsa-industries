-- A person's designation, and creating a login from inside the portal.
--
-- Two problems, one migration, because they are the same problem seen from two
-- sides: an admin could change everything about an account that already existed
-- and had no way to make one, and the first thing an admin does on day one is make
-- one.
--
--   1. designation. public.users carried full_name, role, phone and is_active, and
--      nothing that said what the person actually does. The org chart has a title,
--      but that is the *post*, not the person: the chart's own migration says so in
--      as many words, and it has to, because a post can be vacant and one person can
--      hold two of them. A new hire has a designation on their offer letter long
--      before there is a post for them to sit in, and "Quality Chemist" is not
--      recoverable from the fact that their login role is qc_staff.
--
--      So designation is a column on the person, free text, nullable, and
--      deliberately not the role enum and not a foreign key to the chart. The same
--      argument the org chart makes about titles applies here: a job title changes
--      with a promotion, and a schema migration per promotion is not a thing anyone
--      is going to do. When both exist the chart shows the post title as the
--      heading and the designation underneath it, because that is what they are for.
--
--   2. account creation. Every account in this database was made out of band,
--      because auth.users is GoTrue's table and the service role key must never
--      reach a browser. Two ways around that have been tried: an edge function
--      holding the key, which needs the function deployed and cannot be deployed
--      from this repository, or a plain SQL write, which is what the pgTAP suites
--      have always done. This migration takes the second route, on three
--      conditions, each of which was checked against this project rather than
--      assumed:
--
--        * auth.users.email has no default. GoTrue writes it. So the insert has to
--          supply it, which is only true on the versions that did not make it a
--          generated column; if a future GoTrue generates it, the insert below
--          fails loudly and says so rather than silently creating a nameless
--          account.
--
--        * auth.identities.email IS generated, from identity_data ->> 'email'.
--          Supplying it is an error, not a duplicate value. The identities insert
--          therefore names no columns beyond the six that are real.
--
--        * an AFTER INSERT trigger, private.handle_new_user(), already writes a
--          public.users row for any auth.users insert. So the profile write here is
--          an upsert, not an insert, and the trigger's own role whitelist is
--          repaired in this migration rather than worked around: it does not
--          mention qc_staff, so a QC login created through it silently arrived as
--          sales_rep.
--
--      All of it is one function, so one bad argument cannot leave an auth row with
--      no profile behind it. A half-created account is the worst outcome available
--      here: it cannot be signed into, cannot be listed, and cannot be found by the
--      screen an admin would use to fix it.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.users
  add column designation text;

comment on column public.users.designation is
  'Free-text job title for the person, independent of both the permission role and the post they hold on the org chart. Null means nobody has written one down, which is a different statement from an empty string and is why this is nullable rather than defaulted.';

-- A blank designation is a mistake rather than a fact: trim it on the way in, and
-- refuse it at the column so no other writer can store one either.
alter table public.users
  add constraint users_designation_not_blank
  check (designation is null or char_length(trim(designation)) > 0);

-- Bounded, because this is displayed on every card of the org chart and an
-- unbounded free-text field is a layout bug waiting for one long job title. 120
-- characters is longer than any real title.
alter table public.users
  add constraint users_designation_length
  check (designation is null or char_length(designation) <= 120);

alter table public.users
  add constraint users_phone_length
  check (phone is null or char_length(phone) <= 32);

-- ---------------------------------------------------------------------------
-- 2. private.handle_new_user(), with qc_staff in the list
--
-- Recreated rather than replaced in place because the body is short and the
-- difference has to be legible: the whitelist below is the whole permission model
-- of this function, and it was missing a role that this database has been shipping
-- for a while. Anyone who signed a QC officer up through the ordinary Auth path got
-- a sales rep.
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text;
  requested_designation text;
begin
  requested_role := new.raw_app_meta_data ->> 'role';
  requested_designation := nullif(trim(new.raw_user_meta_data ->> 'designation'), '');

  insert into public.users (id, full_name, email, role, designation, is_active)
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
    requested_designation,
    true
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email;

  return new;
end;
$$;

-- The designation is only written on the insert path, not the conflict path: this
-- trigger fires for every signup, including by the vendor's own admin UI, and a
-- signup must not be able to overwrite a designation an admin set later.
comment on function private.handle_new_user() is
  'AFTER INSERT on auth.users, writing the public.users profile row. qc_staff is in the role whitelist, which it was not before this migration: a signup naming that role silently became a sales rep. designation is taken from raw_user_meta_data on first write only.';

-- ---------------------------------------------------------------------------
-- 3. admin_upsert_user_profile, with designation and phone
--
-- Dropped and recreated rather than added as an overload. Postgres would happily
-- keep both signatures, and PostgREST would then have to choose between them on
-- every call: two functions of one name whose argument names are a superset of
-- each other is exactly the PGRST203 ambiguity case. One function, one shape.
--
-- The new arguments have defaults, so every existing caller — every pgTAP suite
-- included — keeps working against the shorter signature. Nothing about the guards
-- below has changed; they are the same guards in the same order.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid);

create function public.admin_upsert_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_is_active boolean,
  p_dealer_id uuid default null,
  p_manager_id uuid default null,
  p_designation text default null,
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
  v_designation text := nullif(trim(p_designation), '');
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

  if v_designation is not null and char_length(v_designation) > 120 then
    raise exception 'That designation is too long. 120 characters is the limit.';
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
         designation = v_designation,
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

comment on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, text, text) is
  'Change a user''s name, designation, phone, role, active flag, dealer link and reporting line in one call, so the profile and the hierarchy cannot disagree. Admin only. The account itself is made by admin_create_user_account. Two lockout guards are deliberate: an admin may not edit their own role or suspend themselves, and the last active admin may not be demoted or suspended. A third refuses to demote or suspend an account that active accounts still report to, so the reporting line cannot be broken from the manager end. A null designation clears it, which is the opposite of how a null manager behaves: a manager is only dropped by omitting it from a role that has one.';

-- ---------------------------------------------------------------------------
-- 4. admin_create_user_account
--
-- The whole account, in one call: the Auth row, the identity row that makes a
-- password sign-in work at all, the profile, and the reporting line.
--
-- Why the identity row is not optional. GoTrue finds a password login through
-- auth.identities: an auth.users row with no identities entry is an account that
-- exists, cannot sign in, and cannot be diagnosed from the application. Writing the
-- auth row alone would produce exactly that.
--
-- Why the password is hashed here rather than by Auth. There is no service role key
-- in this environment, so this function is the whole mechanism. The parameters are
-- the plaintext password and are hashed with the same bcrypt cost GoTrue itself
-- uses ($2a$, 6 rounds), so a stored hash is indistinguishable from one GoTrue
-- produced. The plaintext is not logged, not stored, and not recoverable afterwards:
-- there is no column anywhere holding it.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_user_account(
  p_email text,
  p_full_name text,
  p_password text,
  p_role public.user_role,
  p_designation text default null,
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
  v_designation text := nullif(trim(p_designation), '');
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

  if v_designation is not null and char_length(v_designation) > 120 then
    raise exception 'That designation is too long. 120 characters is the limit.';
  end if;

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
    -- see the header. instance_id, aud and role are the three values every seeded
    -- account in this database carries.
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
  -- this row from the trigger above. Its role whitelist was repaired in this
  -- migration, but relying on that would make this function's correctness depend on
  -- the state of somebody else's trigger, so the role is written here as well.
  insert into public.users (id, full_name, email, role, designation, phone, is_active, dealer_id)
  values (v_user_id, v_name, v_email, p_role, v_designation, v_phone, v_active, p_dealer_id)
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        role = excluded.role,
        designation = excluded.designation,
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

comment on function public.admin_create_user_account(text, text, text, public.user_role, text, text, boolean, uuid, uuid) is
  'Create one login end to end: the auth row, the identity row a password sign-in needs, the profile, and the reporting line. Admin only. This replaces provisioning that had to happen out of band, and it is a SECURITY DEFINER function writing auth.*, so the admin check is the only thing between a request and a new account. Every argument is validated before the first write, and the whole call is one transaction, so a refusal cannot leave an auth row without a profile. The password is hashed with the bcrypt parameters GoTrue itself uses and is not recoverable afterwards. Refuses a duplicate email, a weak password, a dealer account with no dealer, and a reporting line the three-level hierarchy does not allow.';

-- ---------------------------------------------------------------------------
-- 5. admin_set_user_password
--
-- The other half of account creation: an admin setting somebody's password
-- directly, because a person who has lost theirs is standing at the desk and a
-- recovery email is not a thing this deployment can do — Supabase's SMTP is not
-- configured, so the recovery mail would never arrive and the reset would look
-- like a silent failure.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_password(
  p_user_id uuid,
  p_password text,
  p_end_sessions boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can set a password';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No login with that id';
  end if;

  if p_password is null or char_length(p_password) < 8 then
    raise exception 'The password needs at least 8 characters';
  end if;

  if btrim(p_password) = '' then
    raise exception 'The password cannot be only spaces';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 6)),
         updated_at = timezone('utc', now())
   where id = p_user_id;

  -- Off by default, because signing somebody out is a decision and not a side effect
  -- of setting a password. It is here because it is the answer to "I gave them the
  -- new password and they are still signed in on their phone", which is the usual
  -- reason to want this call in the first place.
  if p_end_sessions then
    delete from auth.sessions where user_id = p_user_id;
  end if;
end;
$$;

comment on function public.admin_set_user_password(uuid, text, boolean) is
  'Set somebody''s password directly. Admin only. Refuses anything under 8 characters. p_end_sessions defaults to false because signing somebody out is a decision rather than a side effect; set it when a password is reset after a suspected compromise. Supabase recovery mail is not configured on this project, so this is the only route to a working password, not a shortcut around one.';

-- ---------------------------------------------------------------------------
-- 6. The admin directory, with the two new columns
-- ---------------------------------------------------------------------------

drop view if exists public.user_directory;

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
  u.designation,
  u.phone,
  d.name as dealer_name,
  h.manager_id,
  m.full_name as manager_name,
  m.role as manager_role
from public.users as u
left join public.dealers as d on d.id = u.dealer_id
left join public.user_hierarchy as h on h.user_id = u.id
left join public.users as m on m.id = h.manager_id;

comment on view public.user_directory is
  'Every user with their designation, phone, dealer and manager, for the admin screen. security_invoker so the existing users and user_hierarchy policies still decide who sees a row: an admin sees everyone, a manager sees their own reps.';

revoke all on table public.user_directory from public, anon, authenticated;
grant select on table public.user_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The org chart reads, with the designation
--
-- Dropped top down and rebuilt bottom up, because the view depends on the function
-- and the function's return type changed: there is no CREATE OR REPLACE that widens
-- a RETURNS TABLE. private.org_staff_roster goes before private.org_person because
-- it calls it.
-- ---------------------------------------------------------------------------

drop view if exists public.org_chart;
drop view if exists public.org_staff_roster;
drop function if exists private.org_staff_roster();
drop function if exists private.org_person(uuid);

create or replace function private.org_person(target_user_id uuid)
returns table (full_name text, email text, role public.user_role, designation text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name, u.email, u.role, u.designation, u.is_active
  from public.users as u
  where u.id = target_user_id
    and u.role <> 'dealer'
    and private.is_internal_staff()
$$;

comment on function private.org_person(uuid) is
  'Name, email, role, designation and active flag for one person on the org chart, read past the users RLS that hides every other row from internal staff. One row, or none: no row when the caller is not internal staff, and none for a dealer login, which is a customer account rather than an employee.';

revoke all on function private.org_person(uuid) from public;
grant execute on function private.org_person(uuid) to authenticated;

create or replace function private.org_staff_roster()
returns table (user_id uuid, full_name text, email text, role public.user_role, designation text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, person.full_name, person.email, person.role, person.designation, person.is_active
  from public.users as u
  cross join lateral private.org_person(u.id) as person
$$;

comment on function private.org_staff_roster() is
  'Every employee account, active or suspended, for the org chart pickers. Excludes dealer logins and everything the caller is not entitled to see.';

revoke all on function private.org_staff_roster() from public;
grant execute on function private.org_staff_roster() to authenticated;

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
  person.is_active as user_is_active
from public.org_positions as p
left join lateral private.org_person(p.user_id) as person on true;

comment on view public.org_chart is
  'The org chart as the screen reads it: every post with its parent, its order among its siblings, the person on it, and their designation. security_invoker, so only internal staff can read it.';

revoke all on table public.org_chart from anon, authenticated;
grant select on table public.org_chart to authenticated;

create view public.org_staff_roster
with (security_invoker = true)
as
select r.user_id, r.full_name, r.email, r.role, r.designation, r.is_active
from private.org_staff_roster() as r;

comment on view public.org_staff_roster is
  'Every employee account for the org chart pickers, including suspended ones, and excluding dealer logins. security_invoker over private.org_staff_roster, so a reader who is not internal staff gets no rows rather than the whole company.';

revoke all on table public.org_staff_roster from anon, authenticated;
grant select on table public.org_staff_roster to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Privileges on the new functions
-- ---------------------------------------------------------------------------

revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, text, text) from public;
revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, text, text) from anon;
revoke all on function public.admin_create_user_account(text, text, text, public.user_role, text, text, boolean, uuid, uuid) from public;
revoke all on function public.admin_create_user_account(text, text, text, public.user_role, text, text, boolean, uuid, uuid) from anon;
revoke all on function public.admin_set_user_password(uuid, text, boolean) from public;
revoke all on function public.admin_set_user_password(uuid, text, boolean) from anon;

grant execute on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_create_user_account(text, text, text, public.user_role, text, text, boolean, uuid, uuid) to authenticated;
grant execute on function public.admin_set_user_password(uuid, text, boolean) to authenticated;

-- PostgREST caches its function list, and the six-argument upsert it had cached is
-- now gone. Without this the API keeps offering a signature that no longer exists.
notify pgrst, 'reload schema';