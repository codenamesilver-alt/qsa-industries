begin;
select plan(31);
-- Tests for 20260928104500_admin_map_dealer_to_rep.sql.
--
-- This migration exists because a refusal had no way to be satisfied from the
-- screen the refusal appeared on. admin_activate_dealer refuses a dealer with no
-- active sales rep, and correctly: create_dealer_order reads dealers.sales_rep_id
-- into a not null orders.sales_rep_id, so an unmapped account cannot be ordered
-- for by anyone, including by itself. The only writer of that column before this
-- migration was admin_upsert_dealer, which takes the entire dealer master, so
-- satisfying the refusal meant resending name, address, status, credit limit,
-- credit override, region and rep to change one of them.
--
-- What that costs is the subject of section C. A stale resend does not fail loudly.
-- It silently reverts whatever a finance user changed in between, and it is routed
-- through a guard that splits the commercial columns away from the rest, so an
-- admin's rep change comes back refused with a message about credit. Both are worse
-- than a missing button, and neither is visible until it has already happened to
-- somebody.
--
-- The conventions are stage18's, for the same reasons:
--
--   * Every function call runs impersonated, as reset role followed by
--     set local role authenticated and a request.jwt.claim.sub. The check is
--     private.current_user_role(), which reads auth.uid(), so asserting against
--     the owner would prove nothing: the owner is never stopped by the check
--     because the check is not about the owner.
--   * Every fixture is written as the owner, in between those impersonations.
--     authenticated holds SELECT on dealers and nothing else, so a fixture write
--     run as authenticated would fail on privilege rather than on the fact.
--   * Scratch state lives in a temporary table created as the owner and granted
--     back, so an assertion can name a dealer without a subquery in every line.
--
-- Fixed identifiers, from the seed and earlier migrations:
--   admin            10000000-0000-4000-8000-000000000001
--   sales_director   10000000-0000-4000-8000-000000000002
--   sales_manager A  10000000-0000-4000-8000-000000000003  (Imran)
--   sales_manager B  10000000-0000-4000-8000-000000000004  (Meera)
--   rep Ravi         10000000-0000-4000-8000-000000000005  (Imran's team)
--   rep Sana         10000000-0000-4000-8000-000000000006  (Imran's team)
--   rep Vikram       10000000-0000-4000-8000-000000000007  (Meera's team)
--   rep Ananya       10000000-0000-4000-8000-000000000008  (Meera's team)
--   finance          22145f21-ebba-4e23-8bc5-b9650307a4ea
--   qc_staff         7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--
-- Dealers created here carry 30000000-... and users 19000000-..., both outside the
-- seed and outside stage18, so nothing below can collide with another suite.

-- ===========================================================================
-- A. Fixtures
--
-- Two unassigned inactive dealers, standing in for two fresh onboardings, and
-- three users: a rep who has left, a rep with no account, and a dealer login. The
-- departed rep is the one the rep rule is really about, because a test that read
-- only the role would pass it.
-- ===========================================================================
reset role;

insert into public.dealers (id, name, region, state, credit_limit, status, sales_rep_id)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'Harbour Feeds',
    'West',
    'Gujarat',
    0,
    'inactive',
    null
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'Summit Feeds',
    'East',
    'West Bengal',
    0,
    'inactive',
    null
  );

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '19000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
    'departed.rep@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"sales_rep"}'::jsonb,
    '{"full_name":"Departed Rep"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated',
    'unowned.dealer@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"Unowned Dealer"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

-- The role is right and the flag is not, which is the whole point of this row.
update public.users set is_active = false where id = '19000000-0000-4000-8000-000000000010';

-- The scratch table, so an assertion can name a dealer without a subquery.
create temporary table ob (label text primary key, dealer_id uuid);
grant insert, select on ob to authenticated;

-- ===========================================================================
-- B. The refusals
-- ===========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000005')$$,
  'P0001',
  'No dealer with that id',
  'a dealer id that does not exist is refused, before the rep is even looked at'
);

-- The rep test. Four different ways of not being an active sales rep, all with the
-- same message, because they are one rule and a rule with four messages is four
-- rules to keep in step.
select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003')$$,
  'P0001',
  'A dealer must be mapped to an active sales rep',
  'a sales manager is not a sales rep, however senior'
);

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')$$,
  'P0001',
  'A dealer must be mapped to an active sales rep',
  'a sales director is not a sales rep'
);

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901')$$,
  'P0001',
  'A dealer must be mapped to an active sales rep',
  'qc_staff is not a sales rep'
);

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000010')$$,
  'P0001',
  'A dealer must be mapped to an active sales rep',
  'a sales rep who is no longer active is refused, because the rule says active and not merely rep'
);

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  'P0001',
  'A dealer must be mapped to an active sales rep',
  'a user id with no profile behind it is refused'
);

-- Every role but admin. The check is on the role and not on a list of exceptions,
-- so a rep, a manager, a dealer login and finance all get the same sentence.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'Only an admin can map a dealer to a sales rep',
  'a sales rep cannot map a dealer, not even a dealer nobody owns'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'Only an admin can map a dealer to a sales rep',
  'a sales manager cannot use this, and cannot reach it through their own function either'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-000000000011';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'Only an admin can map a dealer to a sales rep',
  'a dealer login cannot reassign itself to a rep, which is the caller most likely to try'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'Only an admin can map a dealer to a sales rep',
  'finance cannot map a dealer, even though finance owns the credit limit'
);

-- A disabled admin is the one caller for whom checking the role alone would let
-- the change through, so this is the assertion that says the flag is in the check.
reset role;

update public.users set is_active = false where id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'Only an admin can map a dealer to a sales rep',
  'a disabled admin is refused, so the test is on the role and the flag'
);

reset role;

update public.users set is_active = true where id = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- C. The write, and what it does not touch
--
-- The point of a narrow function is that it changes one column, and the only way
-- to hold that is to compare every other column before and after. Comparing the
-- row as json with sales_rep_id removed, rather than listing columns, so a column
-- added to dealers later does not silently escape the check.
-- ===========================================================================
update public.dealers
   set credit_limit = 125000,
       credit_limit_override = 150000,
       contact_person = 'Summit contact',
       phone = '+91 90000 00002'
 where id = '30000000-0000-4000-8000-000000000002';

create temporary table before_map as
select (to_jsonb(d) - 'sales_rep_id') as rest
from public.dealers as d
where d.id = '30000000-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select sales_rep_id::text from public.dealers where id = '30000000-0000-4000-8000-000000000001'),
  null,
  'the dealer starts unassigned, which is the state admin_activate_dealer refuses'
);

-- What unassigned means for the office. can_view_dealer is false on a null rep, so
-- before this function existed the dealer was invisible to every manager, and
-- after it exists they still are: only an admin can place it. The pair of
-- assertions around the write below is the actual product change.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  private.can_view_dealer('30000000-0000-4000-8000-000000000001'),
  false,
  'an unassigned dealer is invisible to a sales manager, because can_view_dealer is false on a null rep'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (public.admin_map_dealer_to_rep(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000005'
  )).sales_rep_id,
  '10000000-0000-4000-8000-000000000005'::uuid,
  'the function returns the dealer row it wrote, carrying the new rep'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  private.can_view_dealer('30000000-0000-4000-8000-000000000001'),
  true,
  'and the dealer joins Ravi own team the moment the admin maps it, which is the reason to do it'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select ok(
  (public.admin_map_dealer_to_rep(
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000007'
  )).sales_rep_id = '10000000-0000-4000-8000-000000000007'::uuid,
  'mapping a dealer that carries a credit limit and an override succeeds'
);

reset role;

select is(
  (
    select to_jsonb(d) - 'sales_rep_id'
    from public.dealers as d
    where d.id = '30000000-0000-4000-8000-000000000002'
  ),
  (select rest from before_map),
  'every column other than sales_rep_id is byte for byte what it was, including the timestamps'
);

select is(
  (select sales_rep_id::text from public.dealers where id = '30000000-0000-4000-8000-000000000002'),
  '10000000-0000-4000-8000-000000000007',
  'and the rep is the one that was asked for'
);

select is(
  (select credit_limit_override from public.dealers where id = '30000000-0000-4000-8000-000000000002'),
  150000::numeric,
  'the finance owned credit override survives, which a full master resend would revert'
);

select is(
  (select status from public.dealers where id = '30000000-0000-4000-8000-000000000001'),
  'inactive'::public.dealer_status,
  'mapping a rep does not activate the dealer, because activation is a separate decision'
);

-- ===========================================================================
-- D. Idempotence
--
-- The card disables its own button when the selection already matches, so this is
-- not reachable from the screen. It is reachable from a double submit, a retry
-- after a dropped response, or two admins on the same dealer, and the answer has
-- to be the dealer row rather than a refusal, because a refusal here reads as a
-- failure for something that had already been done.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (public.admin_map_dealer_to_rep(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000005'
  )).sales_rep_id,
  '10000000-0000-4000-8000-000000000005'::uuid,
  'mapping a dealer to the rep it already has returns the dealer rather than refusing'
);

-- ===========================================================================
-- E. Unassigning, and the asymmetry with the manager path
--
-- Unassigning is allowed here and refused by sales_assign_dealer_to_rep, and the
-- asymmetry is the design rather than an oversight. A manager clearing a mapping
-- takes the dealer out of every manager's reach, because can_view_dealer is false
-- on a null rep and only an admin can get it back. This caller is the admin.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (public.admin_map_dealer_to_rep('30000000-0000-4000-8000-000000000001', null)).sales_rep_id,
  null::uuid,
  'an admin may leave a dealer unassigned again'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.sales_assign_dealer_to_rep('30000000-0000-4000-8000-000000000002', null)$$,
  'P0001',
  'Pick a sales rep; only an admin can leave a dealer unassigned',
  'the manager path still refuses a null target, so the two cannot drift into agreeing by accident'
);

-- A manager cannot claim the unassigned dealer, which is the gap this function
-- fills and does not widen. The message is the team check and not the unassigned
-- one, and that is worth recording rather than tidying away: can_view_dealer asks
-- whether the manager is an ancestor of the dealer's rep, so on a null rep it is
-- false, and the "That dealer has no sales rep" check further down
-- sales_assign_dealer_to_rep can never be reached. Both refusals are correct and
-- both stop the move; only the first one is the one a manager ever sees, so the
-- branch below is dead rather than load bearing.
select throws_ok(
  $$select public.sales_assign_dealer_to_rep('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006')$$,
  'P0001',
  'That dealer is not in your team; only an admin can move a dealer between managers',
  'a manager cannot claim the unassigned dealer, and is told the team check, which is the one that fires'
);

-- ===========================================================================
-- F. The reason the function exists
--
-- Section E is the precondition. This is the payoff: a dealer that is approved,
-- logged in and inactive cannot go live, and the only missing fact was the rep.
-- Without a way to set it, the flow stops on a refusal with no way forward.
-- ===========================================================================
reset role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated',
  'summit.reopened@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Summit Reopened"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into ob (label, dealer_id)
select 'reopened', id
from public.admin_start_dealer_onboarding('Summit Feeds Reopened', 'East', null, null, 40000);

reset role;

-- The rest of the facts the function checks, written as the owner because
-- authenticated holds SELECT on the onboarding table and nothing else. The
-- onboarding is otherwise driven through the stage18 functions one at a time, and
-- that is a different suite's job.
update public.dealer_onboardings as o
   set credit_approved = true,
       credit_decided_at = now(),
       credit_decided_by = '10000000-0000-4000-8000-000000000001',
       credit_decision_note = 'Approved for the suite',
       login_user_id = '19000000-0000-4000-8000-000000000012',
       login_provisioned_at = now()
  from ob
 where o.dealer_id = ob.dealer_id
   and ob.label = 'reopened';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_activate_dealer(dealer_id) from ob where label = 'reopened'$$,
  'P0001',
  'Map the dealer to an active sales rep before activating, or no one can order for it',
  'an approved, logged in dealer with no rep is still refused activation'
);

select ok(
  (public.admin_map_dealer_to_rep(
    (select dealer_id from ob where label = 'reopened'),
    '10000000-0000-4000-8000-000000000006'
  )).sales_rep_id = '10000000-0000-4000-8000-000000000006'::uuid,
  'the rep mapping that satisfies the refusal is now reachable'
);

select ok(
  (public.admin_activate_dealer(
    (select dealer_id from ob where label = 'reopened')
  )).status = 'active'::public.dealer_status,
  'and the dealer activates once the rep is mapped, which is the entire point of the migration'
);

reset role;

select is(
  (select credit_limit from public.dealers where name = 'Summit Feeds Reopened'),
  40000::numeric,
  'the requested limit became the dealer limit through activation, not through the mapping'
);

select is(
  (select status from public.dealers where name = 'Summit Feeds Reopened'),
  'active'::public.dealer_status,
  'and the dealer is trading'
);

-- ===========================================================================
-- G. Privileges
-- ===========================================================================
select ok(
  has_function_privilege('authenticated', 'public.admin_map_dealer_to_rep(uuid, uuid)', 'execute'),
  'authenticated can execute it, because the browser is the caller'
);

select ok(
  not has_function_privilege('anon', 'public.admin_map_dealer_to_rep(uuid, uuid)', 'execute'),
  'anon cannot execute it'
);

select * from finish();
rollback;
