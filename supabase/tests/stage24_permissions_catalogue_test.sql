begin;
select plan(42);

-- Tests for the permission catalogue: 20261003150000_permissions_catalogue.sql.
--
-- What the migration adds. A named list of permissions, a role tier read out of the
-- existing RLS policies rather than invented, a designation layer on top of it, and
-- one function -- private.can_access(code) -- that answers "may this person do
-- this". The base tier is locked; the designation layer is what the future Roles and
-- Permissions screen writes.
--
-- The conventions are stage21's and stage23's, for the same reasons. Every function
-- call runs impersonated: reset role, then set the claim, then set local role
-- authenticated, because private.current_user_role() reads auth.uid() and asserting
-- against the owner would prove nothing. Fixtures are written as the owner in
-- between those impersonations. Two details that have cost suites in this directory
-- a rebuild, both of them mine:
--
--   1. Fixtures go into auth.users and nothing else. public.users.id is a foreign
--      key onto auth.users, and private.handle_new_user is a trigger on auth.users
--      that writes the profile row itself. Writing public.users directly fails the
--      key; writing it again after the trigger fails on the duplicate.
--   2. After a `reset role`, the claim has to be set again before any writer RPC.
--      auth.uid() is null as the owner, so private.current_user_role() returns null,
--      which is distinct from 'admin', and the RPC raises. A reset that looks like
--      "back to a clean slate" is really "back to a caller with no identity".
--
-- Seeds that matter below:
--   admin     10000000-0000-4000-8000-000000000001
--   qc_staff  7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--
-- The qc_staff seed is load-bearing: a quality chemist is a real role the base tier
-- gives nothing extra to, which makes it the only honest subject for "a designation
-- grant is what gives this person the screen".

-- ===========================================================================
-- A. Fixtures
--
-- Three employees, each of which has to be told a different answer by
-- private.can_access: a finance officer answered by the role tier, a quality chemist
-- answered by neither tier until this suite grants something to a title, and a
-- suspended officer who must be answered by nothing at all.
--
-- The dealer is a fourth, and is the important one. The escalation the exclusion
-- rules out is an admin granting "Store Keeper" the purchasing screen and a dealer
-- account then being given that title.
-- ===========================================================================
reset role;

-- auth.users, for both reasons in the header. Emails are on example.test so they
-- can never collide with a real address.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('1a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'zz.permission.officer@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"finance"}'::jsonb,
   '{"full_name":"ZZ Permission Test Officer"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('1a000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'zz.permission.suspended@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"finance"}'::jsonb,
   '{"full_name":"ZZ Permission Test Suspended"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  ('1a000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
   'zz.permission.dealer@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"dealer"}'::jsonb,
   '{"full_name":"ZZ Permission Test Dealer"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

-- The suspended one, which the trigger created as active. Set here rather than
-- passed in, because there is no way to ask the trigger for an inactive account and
-- an inactive account is the whole fixture.
update public.users
   set is_active = false
 where id = '1a000000-0000-4000-8000-000000000003';

-- Two titles in the catalogue, written straight into the table because the writer
-- function refuses anybody who is not an admin and this block runs before a claim is
-- set.
--
-- d1 goes on the chemist and on the dealer. The chemist is the subject of the
-- designation layer; the dealer is the subject of the exclusion, and only gets
-- interesting once d1 has been granted something. d2 goes on the finance officer,
-- who is the subject of the union in both directions.
insert into public.designations (id, name, description, sort_order)
values
  ('1a000000-0000-4000-8000-0000000000d1',
   'ZZ Permission Test Title',
   'Created by stage24 and removed by it',
   9999),
  ('1a000000-0000-4000-8000-0000000000d2',
   'ZZ Permission Test Second Title',
   'Created by stage24 and removed by it',
   9998);

update public.users
   set designation_id = case id
         when '1a000000-0000-4000-8000-000000000002'
           then '1a000000-0000-4000-8000-0000000000d2'::uuid
         else '1a000000-0000-4000-8000-0000000000d1'::uuid
       end
 where id in (
   '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901',   -- qc_staff
   '1a000000-0000-4000-8000-000000000004',   -- the dealer
   '1a000000-0000-4000-8000-000000000002'    -- the finance officer, who holds d2
 );

-- ===========================================================================
-- B. The catalogue and the matrix
--
-- Read as a signed-in non-admin, because that is who has to be able to render the
-- screen the list exists to feed.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
set local role authenticated;

-- 1. every code is a group and an action, so the screen can group them without
--    parsing prose and without a permissions_group table
select is(
  (
    select count(*)::int
      from public.permissions
     where is_active
       and public.permissions.code !~ '^[a-z_]+\.[a-z_]+$'
  ),
  0,
  'every permission code is a group and an action'
);

-- 2. and nothing is in the empty group, which would put it nowhere on the screen
select is(
  (
    select count(*)::int
      from public.permissions
     where is_active
       and btrim(coalesce(group_name, '')) = ''
  ),
  0,
  'no permission is left in an empty group'
);

-- 3. the catalogue is populated. An exact count would break every time a screen is
--    added, and the count itself is not the claim; having the seed at all is.
select ok(
  (select count(*) from public.permissions where is_active) > 0,
  'the permission catalogue is populated'
);

-- 4. the matrix view has one row per active permission, so a permission cannot be
--    invisible on the screen while still being enforced
select is(
  (select count(*) from public.permission_matrix),
  (select count(*) from public.permissions where is_active),
  'the matrix has exactly one row per active permission'
);

-- 5. and it carries the role layer, with admin left false because admin is answered
--    by the bypass rather than by a grant. An admin row reading true would mean the
--    bypass and the catalogue disagree about the same question.
select is(
  (
    select (by_role ->> 'admin')::boolean
      from public.permission_matrix
     where code = 'finance.view_invoices'
  ),
  false,
  'the matrix reports the role tier, and admin is false because the bypass is separate'
);

-- 6. and it carries the designation layer, with the same permission answered no on
--    that layer before anything is granted
select is(
  (
    select (by_designation ->> '1a000000-0000-4000-8000-0000000000d1')::boolean
      from public.permission_matrix
     where code = 'finance.view_invoices'
  ),
  false,
  'the matrix reports the designation layer, and the answer is no before any grant'
);

-- ===========================================================================
-- C. Resolution
--
-- private.can_access has to answer for four callers plus one that is not signed in,
-- and the answer has to be different for each.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 7. an administrator gets everything, with no grant anywhere
select is(
  private.can_access('finance.view_invoices'),
  true,
  'an administrator is answered yes without any grant in either layer'
);

-- 8. including a permission that does not exist. The bypass runs before the lookup,
--    so an admin checking a typo is told yes rather than told the permission is
--    missing. Worth pinning, because moving the lookup earlier looks like a tidy-up
--    and silently changes what this returns.
select is(
  private.can_access('finance.not_a_real_permission'),
  true,
  'the administrator bypass covers even a permission that does not exist'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000002';

-- 9. the finance officer is answered by the role tier alone
select is(
  private.can_access('finance.view_invoices'),
  true,
  'a finance officer holds the finance permissions through the role tier'
);

-- 10. and not the purchasing one, so the assertion above is about the right code
select is(
  private.can_access('purchasing.manage_orders'),
  false,
  'a finance officer does not hold a purchasing permission'
);

set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

-- 11. the chemist, who holds a title with no grants against it, is answered by
--     nothing: the base tier gives qc_staff no finance permission
select is(
  private.can_access('finance.view_invoices'),
  false,
  'a chemist holding a title with no grants is still refused the finance permission'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000003';

-- 12. a suspended officer has nothing, whatever the role tier says
select is(
  private.can_access('finance.view_invoices'),
  false,
  'a suspended officer is refused even the permission their role tier would grant'
);

-- 13. and a signed-out caller is refused rather than defaulting to true. This is the
--     assertion that matters most in the file: a can_access that returned true for a
--     null caller would hand every screen to every visitor. The claim is cleared
--     rather than unset, because `set local x = null` writes an empty string and
--     auth.uid() reads that as no session either way.
reset role;
set local request.jwt.claim.sub = '';
set local role authenticated;

select is(
  private.can_access('finance.view_invoices'),
  false,
  'a caller with no session is refused rather than defaulted to yes'
);

-- ===========================================================================
-- D. The designation layer, which is the point of the migration
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 14. granting a title a permission grants it to its holder
select ok(
  public.admin_grant_designation_permission(
    '1a000000-0000-4000-8000-0000000000d1',
    'finance.view_invoices'
  ),
  'granting a permission to a job title succeeds for an admin'
);

set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

-- 15. and reaches the person holding that title
select is(
  private.can_access('finance.view_invoices'),
  true,
  'a designation grant reaches the person who holds that designation'
);

-- 16. and only that permission, not its group
select is(
  private.can_access('finance.record_payments'),
  false,
  'a designation grant is for the one permission, not the group it is grouped under'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 17. and the matrix shows it, so the screen reflects the grant without the screen
--     having to reimplement the resolution
select is(
  (
    select (by_designation ->> '1a000000-0000-4000-8000-0000000000d1')::boolean
      from public.permission_matrix
     where code = 'finance.view_invoices'
  ),
  true,
  'the matrix shows the designation grant that was just made'
);

-- ===========================================================================
-- E. The union, in both directions
--
-- Role tier OR designation tier. Both halves of that sentence need an assertion,
-- and the wrong implementation is "designation wins", which stays silent until the
-- day somebody loses a screen they had before an admin clicked a box.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 18. granting a title something its holders already have through their role is
--     accepted, because the catalogue is additive and says so in the docs
select ok(
  public.admin_grant_designation_permission(
    '1a000000-0000-4000-8000-0000000000d2',
    'finance.record_payments'
  ),
  'granting a title a permission its holders already have through their role succeeds'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000002';

-- 19. and it does not take anything away. If the union were ever implemented as
--     "designation wins", this is the assertion that fails.
select is(
  private.can_access('finance.record_payments'),
  true,
  'a designation grant on top of a role grant leaves the permission held'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 20. and a title granted something the role does not have adds it
select ok(
  public.admin_grant_designation_permission(
    '1a000000-0000-4000-8000-0000000000d2',
    'purchasing.manage_orders'
  ),
  'granting a title a permission its holders do not have through their role succeeds'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000002';

-- 21. and it reaches the holder, which is the only role in the business that has it
select is(
  private.can_access('purchasing.manage_orders'),
  true,
  'the permission reaches the holder through the designation layer alone'
);

-- 22. revoking takes it off again, which is what makes the screen reversible
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select ok(
  public.admin_revoke_designation_permission(
    '1a000000-0000-4000-8000-0000000000d2',
    'purchasing.manage_orders'
  ) is not false,
  'revoking a designation permission succeeds for an admin'
);

set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000002';

-- 23. and the role tier is untouched by that revoke: the permission is gone from the
--     designation layer and still there from the role. One assertion for both halves,
--     because they are the same union and half an assertion proves nothing.
select is(
  (
    select array[
             private.can_access('purchasing.manage_orders')::text,
             private.can_access('finance.record_payments')::text
           ]
  ),
  array['false', 'true'],
  'revoking a designation grant takes it off and leaves the role tier alone'
);

-- ===========================================================================
-- F. A dealer is not lifted into an internal permission
--
-- The dealer is holding d1, which by now has finance.view_invoices granted to it. If
-- the exclusion were dropped this returns true, and a customer login walks into the
-- finance screen.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '1a000000-0000-4000-8000-000000000004';
set local role authenticated;

select is(
  private.can_access('finance.view_invoices'),
  false,
  'a dealer holding a granted job title is still refused the internal permission'
);

-- ===========================================================================
-- G. The base tier cannot be edited through the screen
--
-- Both role writers raise for everybody, admin included. The screen is a designation
-- screen; if an admin could reach these, the seed would stop being the thing the
-- policies were read out of, and section I would be asserting against a catalogue
-- that had been edited underneath it.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select throws_ok(
  $$select public.admin_grant_role_permission('qc_staff'::public.user_role, 'finance.view_invoices')$$,
  'The base role tier is fixed. Grant the permission to a job title instead',
  'an admin cannot add a permission to the role tier'
);

-- 26. and the refusal changed nothing
select is(
  (
    select count(*)::int
      from public.role_permissions
     where role = 'qc_staff'
       and permission_code = 'finance.view_invoices'
  ),
  0,
  'the refused role grant left no row behind'
);

select throws_ok(
  $$select public.admin_revoke_role_permission('finance'::public.user_role, 'finance.view_invoices')$$,
  'The base role tier is fixed. It is read off the policies, not configured',
  'an admin cannot remove a permission from the role tier'
);

-- 28. and finance kept it
select is(
  (
    select count(*)::int
      from public.role_permissions
     where role = 'finance'
       and permission_code = 'finance.view_invoices'
  ),
  1,
  'the refused role revoke left the base tier grant in place'
);

-- ===========================================================================
-- H. The writers are guarded
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
set local role authenticated;

-- 29. a chemist cannot grant a title a permission
select throws_ok(
  $$select public.admin_grant_designation_permission('1a000000-0000-4000-8000-0000000000d2', 'finance.view_settings')$$,
  'Only an admin can change what a job title may do',
  'a non-admin cannot grant a permission to a job title'
);

-- 30. nor revoke one
select throws_ok(
  $$select public.admin_revoke_designation_permission('1a000000-0000-4000-8000-0000000000d1', 'finance.view_invoices')$$,
  'Only an admin can change what a job title may do',
  'a non-admin cannot revoke a permission from a job title'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 31. an unknown code is refused rather than stored, because a row nobody can read
--     is a row that will be read some day
select throws_ok(
  $$select public.admin_grant_designation_permission('1a000000-0000-4000-8000-0000000000d2', 'finance.not_a_real_permission')$$,
  'No active permission with that code',
  'granting an unknown permission code is refused'
);

-- 32. revoking what was never granted is still a success, so a double click on an
--     un-tick does not produce a red box. It returns true rather than false because
--     the function reports "the grant table no longer holds this", not "a row was
--     deleted": the screen cannot tell the difference and does not need to.
select is(
  public.admin_revoke_designation_permission(
    '1a000000-0000-4000-8000-0000000000d2',
    'sales.view_reports'
  ),
  true,
  'revoking a permission that was never granted still reports success rather than raising'
);

-- 33. and anon cannot reach either writer. The claim is cleared first, and that is
--     the whole point: as owner, then as anon, a stale request.jwt.claim.sub from
--     an earlier impersonation is still in the session, auth.uid() returns the
--     admin, and the guard waves the call through. An earlier version of these two
--     assertions passed for that reason and proved nothing about anon at all.
--
--     Note which refusal this is. A new function gets EXECUTE granted to PUBLIC by
--     default, and 20261003150000 adds `grant execute ... to authenticated` without
--     a matching revoke from public, so anon is stopped by the admin check inside
--     the function rather than by the privilege system. That is safe -- the check
--     runs as the definer and reads the real role -- but it means the guard, not
--     the grant list, is what stops a signed-out caller, and the guard is the thing
--     to keep.
reset role;
set local request.jwt.claim.sub = '';
set local role anon;

select throws_ok(
  $$select public.admin_grant_designation_permission('1a000000-0000-4000-8000-0000000000d1', 'finance.view_invoices')$$,
  'Only an admin can change what a job title may do',
  'anon cannot reach the designation grant writer'
);

-- 34. nor the revoke one
select throws_ok(
  $$select public.admin_revoke_designation_permission('1a000000-0000-4000-8000-0000000000d1', 'finance.view_invoices')$$,
  'Only an admin can change what a job title may do',
  'anon cannot reach the designation revoke writer'
);

-- 35. nothing writes the grant tables directly. Both tables are RLS and their only
--     writers are the security definer functions, so a direct write has to be
--     impossible rather than merely unused.
reset role;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
set local role authenticated;

select is(
  (
    select count(*)::int
      from pg_policies
     where schemaname = 'public'
       and tablename in ('role_permissions', 'designation_permissions')
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0,
  'no policy lets anybody write the grant tables directly'
);

-- 36. a retired title is refused a grant, as the owner: retiring a title and granting
--     one are separate decisions, and a grant to a retired title would sit there
--     invisible until somebody restored it.
reset role;

update public.designations
   set is_active = false
 where id = '1a000000-0000-4000-8000-0000000000d2';

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select throws_ok(
  $$select public.admin_grant_designation_permission('1a000000-0000-4000-8000-0000000000d2', 'finance.view_settings')$$,
  'No active job title with that id',
  'a retired job title is refused a new grant'
);

-- 37. but revoking from a retired title still works, which is the case that makes
--     retirement usable at all: an admin has to be able to tidy up a title they
--     retired last week without restoring it first
select is(
  public.admin_revoke_designation_permission(
    '1a000000-0000-4000-8000-0000000000d2',
    'finance.record_payments'
  ),
  true,
  'a grant can still be revoked from a retired job title'
);

-- ===========================================================================
-- I. The seed still agrees with the policies it was read out of
--
-- The role tier was transcribed from the RLS policies. If somebody edits a policy
-- later and does not update the catalogue, every screen that asks private.can_access
-- disagrees with the database. These read the roles straight out of pg_policies and
-- compare them against role_permissions, which is the only place the two can be
-- checked against each other.
--
-- admin is excluded from the comparison: it is answered by the bypass and appears in
-- every policy by design, while it deliberately has no rows in role_permissions.
--
-- Roles are read out of the policy text with position() rather than a regex.
-- An earlier version used regexp_matches in the FROM clause and produced an empty
-- table, which made assertions 38, 40 and 41 pass by comparing nothing against
-- nothing. Three green tests that cannot fail are worse than three red ones, so the
-- mechanism here is deliberately dull, and the first assertion is the one that
-- proves the extraction worked before the rest lean on it.
-- ===========================================================================
reset role;

create temporary table policy_roles as
  select r.role,
         (position('''' || r.role::text || '''::user_role' in coalesce(p.with_check, p.qual)) > 0)
           as named_in_policy
    from pg_policies as p
    cross join unnest(enum_range(null::public.user_role)) as r (role)
   where p.schemaname = 'public'
     and p.policyname = 'purchase_orders_write_internal';
grant select on policy_roles to authenticated;

create temporary table policy_roles_production as
  select r.role,
         (position('''' || r.role::text || '''::user_role' in coalesce(p.with_check, p.qual)) > 0)
           as named_in_policy
    from pg_policies as p
    cross join unnest(enum_range(null::public.user_role)) as r (role)
   where p.schemaname = 'public'
     and p.policyname = 'production_runs_update_internal';
grant select on policy_roles_production to authenticated;

create temporary table policy_roles_stock as
  select r.role,
         (position('''' || r.role::text || '''::user_role' in coalesce(p.with_check, p.qual)) > 0)
           as named_in_policy
    from pg_policies as p
    cross join unnest(enum_range(null::public.user_role)) as r (role)
   where p.schemaname = 'public'
     and p.policyname = 'stock_levels_select_scope';
grant select on policy_roles_stock to authenticated;

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- 38. the extraction found something. Without this, the next three are unfalsifiable.
select ok(
  (select count(*) from policy_roles where named_in_policy and role <> 'admin') > 0,
  'the roles were actually read out of the policy text'
);

-- 39. every role the purchase order write policy names has the matching grant
select is(
  (
    select count(*)::int
      from policy_roles
     where named_in_policy
       and role <> 'admin'
       and not exists (
         select 1
           from public.role_permissions as rp
          where rp.role = policy_roles.role
            and rp.permission_code = 'purchasing.manage_orders'
       )
  ),
  0,
  'every role the purchase order write policy names has the matching grant'
);

-- 40. and every grant belongs to a role the policy names, so the two sets are equal
--     rather than merely compatible. This is the assertion that fails if somebody
--     edits a policy later and does not touch the catalogue.
select is(
  (
    select count(*)::int
      from public.role_permissions as rp
     where rp.permission_code = 'purchasing.manage_orders'
       and not exists (
         select 1 from policy_roles as pr
          where pr.role = rp.role
            and pr.named_in_policy
       )
  ),
  0,
  'every purchase order write grant belongs to a role the policy names'
);

-- 41. and the same for production runs, in the direction that holds. qc_staff is
--     named in the production policy but is not a holder of production.manage_runs,
--     because a chemist may complete somebody else's run without being able to
--     start one. That is a deliberate difference between the policy and the base
--     tier, so only the grant-implies-policy direction is asserted here.
select is(
  (
    select count(*)::int
      from public.role_permissions as rp
     where rp.permission_code = 'production.manage_runs'
       and not exists (
         select 1 from policy_roles_production as pr
          where pr.role = rp.role
            and pr.named_in_policy
       )
  ),
  0,
  'every production run grant belongs to a role the production policy names'
);

-- 42. and stock reads, which name five roles and all five can view stock
select is(
  (
    select count(*)::int
      from policy_roles_stock
     where named_in_policy
       and role <> 'admin'
       and not exists (
         select 1
           from public.role_permissions as rp
          where rp.role = policy_roles_stock.role
            and rp.permission_code = 'inventory.view_stock'
       )
  ),
  0,
  'every role the stock select policy names has the matching grant'
);

rollback;
