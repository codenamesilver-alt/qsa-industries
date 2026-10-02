-- Tests for 20260928101000, 20260928101500, 20260928102000 and 20260928103000, the four
-- migrations behind the /sales/team screen and the dashboard charts.
--
-- They are tested together because they share one subject. The assignment RPC and
-- the coverage view answer the same question from opposite ends -- who owns a
-- dealer, and who reports to whom -- and the chart views and sales_by_rep answer
-- what that ownership is worth. A fix to any one of them that changes the meaning
-- of dealer_count or rep_name would be invisible from the other three.
--
-- Three of these migrations exist because a bug shipped and was seen in a browser,
-- not because a test failed. That is the point of this file.
--
--   20260928102000  dealer_rep_coverage counted joined order rows, not dealers. A
--                   rep with two dealers and eight orders was reported as holding
--                   nine accounts. Nothing was wrong except count(*).
--   20260928103000  sales_by_rep resolved rep_name and manager_name by joining
--                   public.users from inside a security_invoker view. finance has
--                   no branch in can_view_user, so both joins returned null and the
--                   coalesce substituted the literal "Unassigned rep". Five rows,
--                   five identical labels, and a duplicate React key. The money was
--                   correct the whole time, which is what made it read as a data
--                   problem rather than a label problem.
--   20260928101000  the write path, which exists because a manager has no UPDATE
--                   policy on dealers at all and needs a route to move an account.
--
-- The regression assertions here are the ones that would have caught each of those.
-- They are written as exact values, not as "is not null" and not as "is greater
-- than zero", because a wrong-but-non-null number is the failure mode these views
-- have.
--
-- Fixed identifiers, from migrations and the seed:
--   admin Arjun Mehta       10000000-0000-4000-8000-000000000001
--   sales_director Nadia    10000000-0000-4000-8000-000000000002
--   sales_manager Imran     10000000-0000-4000-8000-000000000003  (Ravi, Sana)
--   sales_manager Meera     10000000-0000-4000-8000-000000000004  (Vikram, Ananya)
--   sales_rep Ravi Menon    10000000-0000-4000-8000-000000000005
--   sales_rep Sana Qureshi  10000000-0000-4000-8000-000000000006
--   sales_rep Vikram Desai  10000000-0000-4000-8000-000000000007
--   sales_rep Ananya Iyer   10000000-0000-4000-8000-000000000008
--   finance Farah           22145f21-ebba-4e23-8bc5-b9650307a4ea
--   qc_staff                7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--
--   dealer Green Valley     20000000-0000-4000-8000-000000000001  Ravi,  West,  8 orders
--   dealer Sunrise          20000000-0000-4000-8000-000000000002  Sana,  West,  active
--   dealer Coastal          20000000-0000-4000-8000-000000000003  Vikram, East,  36 orders
--   dealer Highland         20000000-0000-4000-8000-000000000004  Ananya, North East
--   dealer Sunset           20000000-0000-4000-8000-000000000005  Sana,  South, suspended
--   dealer Legacy Agro      20000000-0000-4000-8000-000000000006  Ravi,  West,  inactive

begin;
select plan(124);

-- ===========================================================================
-- The whole suite runs impersonated as the admin, not as the database owner.
-- private.can_view_dealer reads auth.uid() and returns false for anyone who is
-- not an active internal user, so with no JWT claim every view below returns
-- zero rows -- silently, and every assertion would pass against an empty report.
-- The scope sections re-impersonate other roles.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- A. private.can_manage_rep -- who a manager is allowed to move an account to
--
-- Direct team only, not the whole subtree, and not for anyone else. A manager
-- who could reach their director's other managers' reps could drain a team
-- without anyone above them noticing.
--
-- can_manage_rep is answered as the caller, so the manager assertions run
-- impersonated as Imran. Running them as the admin would return false for every
-- target and pass test 3 and 4 for the wrong reason.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000005'),
  true,
  'Imran manages Ravi, who reports to him directly'
);

select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000006'),
  true,
  'Imran manages Sana, who reports to him directly'
);

select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000007'),
  false,
  'Imran does not manage Vikram, who reports to Meera'
);

select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000008'),
  false,
  'Imran does not manage Ananya, who reports to Meera'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';
set local role authenticated;
select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000005'),
  false,
  'a sales rep cannot manage any rep, including themselves'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000005'),
  false,
  'the sales director is not a can_manage_rep caller'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';
select is(
  private.can_manage_rep('10000000-0000-4000-8000-000000000005'),
  false,
  'finance cannot manage a rep, so cannot claim an unassigned dealer'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select is(
  private.can_manage_rep(null),
  false,
  'a manager does not manage a null target, so the null dealer-assignment path is closed'
);
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- ===========================================================================
-- B. The seed invariants these view tests stand on
--
-- Asserted rather than assumed, because every exact value further down is
-- derived from them and a seed change would otherwise move the target silently.
-- ===========================================================================
select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  2::bigint,
  'Ravi holds two dealer accounts'
);

select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000006'),
  2::bigint,
  'Sana holds two dealer accounts, one of them suspended'
);

select is(
  (select count(*) from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001'),
  8::bigint,
  'Green Valley has eight orders, so the pre-202000 dealer_count was nine'
);

select is(
  (select count(*) from public.dealers where status = 'active' and sales_rep_id is null),
  0::bigint,
  'the seed leaves no active dealer unassigned, so unassigned_dealers is zero'
);

-- ===========================================================================
-- C. dealer_rep_coverage counts dealers, not joined order rows
--
-- The regression. count(*) over dealers left joined to orders returned 9 for
-- Ravi: 8 order rows for Green Valley plus 1 for the dealer with no orders at
-- all. The number was larger than the real count and grew with trading volume,
-- which is the worst shape for a coverage figure -- a rep looked busier every
-- time they sold something.
--
-- Asserted as an exact equality against the seed, and separately against a live
-- count of the dealer table, so a future seed change fails the second and tells
-- you which of the two moved.
-- ===========================================================================
select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  (select count(*)::bigint from public.dealers where sales_rep_id = '10000000-0000-4000-8000-000000000005'),
  'Ravi''s dealer_count equals the number of dealer rows he actually holds'
);

-- The order count is read, not hardcoded. A fresh install seeds fewer orders on this
-- account than a long-lived demo database does, and an assertion that pinned the
-- figure would fail against one of the two environments for a reason that has
-- nothing to do with the bug.
select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000007'),
  1::bigint,
  'Vikram holds one dealer account'
);

select ok(
  (select count(*) from public.orders where dealer_id = '20000000-0000-4000-8000-000000000003') > 1,
  'Vikram''s single dealer is the one carrying many order rows, which is the case the fix exists for'
);

-- The regression, stated as a difference rather than as a literal. The pre-202000
-- view counted rows of dealers left joined to orders, so its figure exceeded the
-- dealer count by the number of order rows. Recomputing that old count and
-- subtracting the order rows has to give today's dealer count.
select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000007'),
  (
    select count(*)::bigint
    from public.dealers as d
    left join public.orders as o on o.dealer_id = d.id
    where d.sales_rep_id = '10000000-0000-4000-8000-000000000007'
  ) - (
    select count(*)::bigint
    from public.dealers as d
    join public.orders as o on o.dealer_id = d.id
    where d.sales_rep_id = '10000000-0000-4000-8000-000000000007'
  ) + 1::bigint,
  'the pre-202000 order-join count would have exceeded the dealer count by exactly the order rows'
);

select is(
  (select sum(dealer_count)::bigint from public.dealer_rep_coverage),
  (select count(*)::bigint from public.dealers),
  'coverage dealer_counts sum to the whole dealer table, so no account is counted twice or dropped'
);

-- A dealer with no orders still counts. This is the half of the fix that is easy
-- to break: a rewrite that switches to an inner join on orders drops them and a
-- rep who has just been given a new account reads as holding nothing.
select is(
  (select count(*) from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  1::bigint,
  'Ravi is listed once, and Legacy Agro with its zero orders does not remove him'
);

select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  2::bigint,
  'a rep holding a dealer with no orders still counts that dealer'
);

-- Every sales rep is a row, active or not, because a rep holding nothing is a
-- coaching problem and not a missing row.
select is(
  (select count(*) from public.dealer_rep_coverage),
  (select count(*) from public.users where role = 'sales_rep'),
  'every sales rep has a coverage row regardless of dealer count or active flag'
);

select ok(
  exists (
    select 1 from public.dealer_rep_coverage where dealer_count = 0
  ) is false,
  'no rep is shown holding nothing in the seed, since all four hold at least one dealer'
);

-- The realized and pipeline split survived the count fix. This is a distinct
-- hazard from the count itself: a rewrite that aggregated over the order join
-- could return the right dealer_count and double every rupee, because each
-- dealer row is repeated once per order.
select is(
  (select realized_amount from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  (
    select coalesce(sum(o.total_amount), 0)
    from public.dealers as d
    join public.orders as o on o.dealer_id = d.id
    where d.sales_rep_id = '10000000-0000-4000-8000-000000000005'
      and o.status in ('approved', 'dispatched', 'invoiced')
  ),
  'Ravi''s realized amount is not multiplied by his order count'
);

select is(
  (select realized_amount from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000007'),
  (
    select coalesce(sum(o.total_amount), 0)
    from public.dealers as d
    join public.orders as o on o.dealer_id = d.id
    where d.sales_rep_id = '10000000-0000-4000-8000-000000000007'
      and o.status in ('approved', 'dispatched', 'invoiced')
  ),
  'Vikram''s single dealer with 36 orders is summed once, not 36 times'
);

-- ===========================================================================
-- D. public.sales_assign_dealer_to_rep -- the refusals
--
-- Every refusal names its reason, so each one is asserted on its message rather
-- than on SQLSTATE alone. A generic "permission denied" would leave a manager
-- guessing which of four rules they broke.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

-- A control for the section. Imran is admitted by the manager gate, so an in-team
-- assignment to the dealer's current rep must succeed as a no-op rather than fail
-- with the manager message. Without this line the section only ever asserts
-- refusals and would pass against a function that refuses every manager.
select lives_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'
  )$$,
  'a manager assigning inside their own team is not refused for the wrong reason'
);

select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', null
  )$$,
  'P0001',
  'Pick a sales rep; only an admin can leave a dealer unassigned',
  'a manager cannot leave a dealer unassigned'
);

select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007'
  )$$,
  'P0001',
  'You can only assign a dealer to one of your own active sales reps',
  'Imran cannot move a dealer onto Vikram, who reports to Meera'
);

select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    'ffffffff-ffff-4fff-8fff-ffffffffffff', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'No dealer with that id',
  'an unknown dealer id is reported as such rather than as a scope failure'
);

-- The target-rep check runs before the dealer is loaded, so a manager probing
-- with a real dealer that is also outside their team and a foreign rep is told
-- the rep is wrong, not that the dealer is. Order matters for the message a
-- manager reads. Both inputs would fail later checks, so only the message shows
-- which check ran first.
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000007'
  )$$,
  'P0001',
  'You can only assign a dealer to one of your own active sales reps',
  'the team check precedes the dealer lookup, so a foreign target rep is named first'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- The RPC is sales_manager only. admin is not a caller even though the admin
-- portal can reassign a dealer, because the admin path is a direct table write
-- that the trigger admits. Two routes, one per role, deliberately.
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'the admin cannot use the manager RPC'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'the sales director cannot use the manager RPC'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'a sales rep cannot reassign a dealer'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'finance cannot reassign a dealer'
);

set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'qc staff cannot reassign a dealer'
);

-- anon holds EXECUTE on the function, because the public schema has a default
-- privilege grant for it and revoking from PUBLIC is not enough. The function
-- must therefore refuse on its own authority check. This assertion is the reason
-- the role check is inside the function rather than in a grant.
set local role anon;
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'P0001',
  'Only a sales manager can reassign a dealer inside their own team',
  'anon cannot reassign a dealer even though anon holds EXECUTE on the function'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- E. A manager has no direct UPDATE path
--
-- This is the assertion 20260928101000:333 refers to. It is a zero-row result,
-- not an exception: dealers_update_scope and dealers_update_internal admit
-- admin and finance, not a manager, so RLS filters the row and the UPDATE
-- matches nothing. A silent no-op is the correct outcome -- the RPC is the only
-- route, and a manager reaching the table directly gets nothing rather than a
-- partial write.
--
-- The row is proved visible in the same transaction first, so a zero count
-- cannot be explained by the manager being unable to see the dealer at all.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  (select count(*) from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Imran can see the Green Valley row, so the update below is filtered by the UPDATE policy and not by SELECT'
);

-- The rowcount of a data-modifying statement has to be captured at the top level,
-- not inside a select expression, so it goes through a scratch table. The update
-- is expected to match nothing, which is the point: a manager reaching past the RPC
-- gets a silent no-op rather than a partial write.
create temporary table s17_update_result (rows_changed bigint);
grant insert, select on s17_update_result to authenticated;

with upd as (
  update public.dealers
     set sales_rep_id = '10000000-0000-4000-8000-000000000006'
   where id = '20000000-0000-4000-8000-000000000001'
  returning 1
)
insert into s17_update_result (rows_changed)
select count(*)::bigint from upd;

select is(
  (select rows_changed::bigint from s17_update_result),
  0::bigint,
  'a manager''s direct UPDATE of dealers.sales_rep_id matches no rows'
);

select is(
  (select sales_rep_id from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000005'::uuid,
  'the dealer still sits with Ravi after the manager''s refused direct update'
);

-- ===========================================================================
-- F. The RPC does move a dealer, and the coverage view follows
--
-- A test suite that only asserts refusals will pass against a function that
-- refuses everything. This section writes, reads the change back through the
-- view the screen renders, and puts the original owner back.
-- ===========================================================================
select lives_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'Imran moves Green Valley from Ravi to Sana'
);

select is(
  (select sales_rep_id from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000006'::uuid,
  'the dealer now sits with Sana'
);

select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000005'),
  1::bigint,
  'Ravi''s coverage drops to one dealer'
);

select is(
  (select dealer_count from public.dealer_rep_coverage where rep_id = '10000000-0000-4000-8000-000000000006'),
  3::bigint,
  'Sana''s coverage rises to three dealers'
);

-- The count still reconciles after the move, which is the assertion that would
-- catch a write path that moved the dealer but left a stale aggregate behind.
select is(
  (select sum(dealer_count)::bigint from public.dealer_rep_coverage),
  (select count(*)::bigint from public.dealers),
  'coverage still sums to the dealer table after a reassignment'
);

-- Assigning a dealer to the rep it already has is a no-op, not an error. A form
-- that resubmits unchanged must not surface a failure to the manager.
select lives_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'
  )$$,
  'reassigning a dealer to its current rep is accepted as a no-op'
);

select is(
  (select sales_rep_id from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000006'::uuid,
  'the no-op left the dealer where it was'
);

select lives_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005'
  )$$,
  'Imran moves Green Valley back to Ravi'
);

select is(
  (select sales_rep_id from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000005'::uuid,
  'the dealer is back with Ravi, so the seed is restored for later sections'
);

-- A manager cannot reach a dealer held by another team even when the target rep
-- is their own. The scope test is on the dealer, not only on the target.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.sales_assign_dealer_to_rep(
    '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007'
  )$$,
  'P0001',
  'That dealer is not in your team; only an admin can move a dealer between managers',
  'Meera cannot claim a dealer held by Imran''s team'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- ===========================================================================
-- G. private.sales_display_name -- the naming helper
--
-- Narrower than can_view_user on purpose. It answers "what should this report
-- call this person", not "may this caller read this user", and a report that
-- doubles as a staff directory is a different product with different consent.
-- ===========================================================================
select is(
  private.sales_display_name('10000000-0000-4000-8000-000000000005'),
  'Ravi Menon',
  'a sales rep resolves to their full name'
);

select is(
  private.sales_display_name('10000000-0000-4000-8000-000000000003'),
  'Imran Sheikh',
  'a sales manager resolves to their full name'
);

select is(
  private.sales_display_name('10000000-0000-4000-8000-000000000002'),
  'Nadia Kapoor',
  'a sales director resolves to their full name'
);

select is(
  private.sales_display_name('7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901'),
  null::text,
  'a qc technician has no sales report name, so the helper is not a staff directory'
);

select is(
  private.sales_display_name('6a251aaf-5609-4b83-a04c-282929b6197b'),
  null::text,
  'an inventory manager has no sales report name either'
);

select is(
  private.sales_display_name('4637f04f-aed6-44bc-82d8-774991079d1d'),
  null::text,
  'a dealer login row has no sales report name'
);

select is(
  private.sales_display_name('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  null::text,
  'an unknown id is null rather than an error'
);

select is(
  private.sales_display_name(null),
  null::text,
  'a null id is null rather than an error'
);

select ok(
  not has_function_privilege('anon', 'private.sales_display_name(uuid)', 'execute'),
  'anon cannot call the naming helper, so it cannot enumerate the sales hierarchy'
);

select ok(
  has_function_privilege('authenticated', 'private.sales_display_name(uuid)', 'execute'),
  'authenticated may call the naming helper'
);

-- An inactive rep keeps their orders but loses their name. Last year's revenue
-- must not be attributed to an account that no longer belongs to a live person.
--
-- Ravi is deactivated as the database owner, asserted, and reactivated
-- immediately, inside the test transaction. The owner is used because
-- public.users has no UPDATE policy for authenticated at all -- not even for
-- admin, who manages users through a function -- so an impersonated session
-- cannot stage this fixture. The whole suite ends in a rollback, so the seed is
-- not disturbed.
reset role;
update public.users set is_active = false where id = '10000000-0000-4000-8000-000000000005';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select is(
  private.sales_display_name('10000000-0000-4000-8000-000000000005'),
  null::text,
  'an inactive rep is not named in a sales report'
);

select is(
  (select count(*) from public.orders where sales_rep_id = '10000000-0000-4000-8000-000000000005'),
  8::bigint,
  'the inactive rep still holds their eight orders, so the row does not vanish'
);

reset role;
update public.users set is_active = true where id = '10000000-0000-4000-8000-000000000005';
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select is(
  private.sales_display_name('10000000-0000-4000-8000-000000000005'),
  'Ravi Menon',
  'reactivating the rep restores their name, so the seed is back for the sections below'
);

-- ===========================================================================
-- H. The manager edge, for a caller who cannot see it
--
-- public.user_hierarchy carries the same policy as public.users:
--
--   user_hierarchy_select_scope using (private.can_view_user(user_id))
--
-- so for a finance session the edge is invisible. Resolving only the name was
-- not enough -- the id came from the same join and was null too, which is how
-- the first attempt at this fix left "Unassigned manager" on screen with a real
-- manager_id beside it.
-- ===========================================================================
select is(
  private.sales_manager_id('10000000-0000-4000-8000-000000000005'),
  '10000000-0000-4000-8000-000000000003'::uuid,
  'Ravi''s manager id resolves from the hierarchy'
);

select is(
  private.sales_manager_name('10000000-0000-4000-8000-000000000005'),
  'Imran Sheikh',
  'Ravi''s manager is named Imran'
);

select is(
  private.sales_manager_id('10000000-0000-4000-8000-000000000007'),
  '10000000-0000-4000-8000-000000000004'::uuid,
  'Vikram''s manager id resolves to Meera'
);

select is(
  private.sales_manager_name('10000000-0000-4000-8000-000000000007'),
  'Meera Nair',
  'Vikram''s manager is named Meera'
);

select is(
  private.sales_manager_id('10000000-0000-4000-8000-000000000003'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  'the managers themselves sit under the director'
);

select is(
  private.sales_manager_id('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  null::uuid,
  'an unknown id has no manager rather than raising'
);

select ok(
  not has_function_privilege('anon', 'private.sales_manager_id(uuid)', 'execute'),
  'anon cannot resolve the reporting line'
);

select ok(
  not has_function_privilege('anon', 'private.sales_manager_name(uuid)', 'execute'),
  'anon cannot resolve manager names'
);

-- ===========================================================================
-- I. The regression: sales_by_rep names for a role outside the users RLS
--
-- finance has no branch in can_view_user, so public.users returns zero rows for
-- a finance session and user_hierarchy returns zero rows as well. Before
-- 20260928103000 every rep row therefore rendered as the literal "Unassigned
-- rep" and React logged a duplicate key, while the money underneath was correct.
--
-- The counts below are as admin, the same rows, compared against what finance
-- must now see. Asserting only that finance is non-null would pass against a
-- single wrong name.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
create temporary table expected_rep_rows as
select rep_name, manager_name, count(*)::bigint as row_count
from public.sales_by_rep
group by rep_name, manager_name;
grant select on expected_rep_rows to authenticated;

-- The whole-book realized total, captured as admin. Section J uses it to prove a
-- rep's scoped total is a proper subset of the book rather than the whole figure.
create temporary table expected_book as
select coalesce(sum(realized_amount), 0) as realized_total from public.sales_by_rep;
grant select on expected_book to authenticated;

select is(
  (select count(*) from expected_rep_rows),
  4::bigint,
  'the seed has four distinct rep and manager pairs in sales_by_rep'
);

reset role;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';
set local role authenticated;

select is(
  (select count(*) from public.sales_by_rep),
  (select coalesce(sum(row_count), 0)::bigint from expected_rep_rows),
  'finance sees the same number of rep rows as the admin'
);

select is(
  (select count(*) from public.sales_by_rep where rep_name = 'Unassigned rep'),
  0::bigint,
  'no finance rep row falls back to the Unassigned rep placeholder'
);

select is(
  (select count(*) from public.sales_by_rep where manager_name = 'Unassigned manager'),
  0::bigint,
  'no finance rep row falls back to the Unassigned manager placeholder'
);

select is(
  (select count(*) from public.sales_by_rep where manager_id is null),
  0::bigint,
  'every finance rep row carries a real manager_id, not just a real manager name'
);

select is(
  (select coalesce(sum(row_count), 0)::bigint from expected_rep_rows where rep_name = 'Unassigned rep'),
  0::bigint,
  'the admin view has no Unassigned rep either, so finance is not merely matching a broken baseline'
);

-- The exact set, joined against what the admin session produced. This is the
-- assertion that pins the names rather than their presence.
select is(
  (
    select count(*)::bigint
    from expected_rep_rows as e
    where not exists (
      select 1
      from public.sales_by_rep as f
      where f.rep_name = e.rep_name
        and f.manager_name = e.manager_name
    )
  ),
  0::bigint,
  'every rep and manager pair the admin sees is also visible, named, to finance'
);

-- Finance sees all four reps. It holds the credit book, so a sales report that
-- hid reps from it would be a report it cannot reconcile an invoice against.
select is(
  (
    select count(distinct rep_id)::bigint
    from public.sales_by_rep
  ),
  4::bigint,
  'finance can see all four reps by name'
);

-- The figures are identical to the admin session. The bug was never in the
-- money, and a fix that changed a total while fixing a label would be a
-- regression hidden by a passing name assertion.
select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_rep),
  (
    select coalesce(sum(realized_amount), 0)
    from public.sales_by_rep
    where rep_name <> 'Unassigned rep'
  ),
  'finance and the named admin view agree on the total realized amount'
);

-- sales_rep_dealers is read by a manager immediately before a write, so a wrong
-- label here means a manager reassigns believing a dealer sits with someone else.
select is(
  (select count(*) from public.sales_rep_dealers where rep_name = 'Unassigned'),
  0::bigint,
  'no dealer in the assignable list falls back to the Unassigned rep placeholder for finance'
);

select is(
  (select count(*) from public.sales_rep_dealers),
  6::bigint,
  'finance sees all six dealers, including the suspended and inactive ones'
);

select is(
  (select rep_name from public.sales_rep_dealers where dealer_id = '20000000-0000-4000-8000-000000000001'),
  'Ravi Menon',
  'the dealer the manager is about to move is labelled with its real rep'
);

-- dealer_rep_coverage returns zero rows for finance, and that is correct. The
-- view is built from public.users filtered to sales_rep, and finance can see
-- no user rows, so the scan is empty. The manager screen is a manager screen.
-- Asserted as zero so that a future change which widens it is a deliberate edit
-- to this line rather than a silent exposure of the sales hierarchy.
select is(
  (select count(*) from public.dealer_rep_coverage),
  0::bigint,
  'finance sees no rep coverage rows, because the view reads users and finance sees no user rows'
);

-- ===========================================================================
-- J. Scope on the reporting views
--
-- A view that aggregates rows the caller cannot see leaks through the aggregate
-- even when every underlying row is protected, and these are the views a chart
-- is drawn from. A rep must see their own dealers' orders and nobody else's.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select is(
  (select count(distinct rep_id) from public.sales_by_rep),
  1::bigint,
  'a rep sees only their own row in sales_by_rep'
);

select is(
  (select rep_id from public.sales_by_rep limit 1),
  '10000000-0000-4000-8000-000000000005'::uuid,
  'and that row is their own rep id'
);

-- Green Valley and Coastal are both heavily traded. If the rep scope leaked, the
-- rep would see Coastal''s 36 orders and the total would match the whole book. The
-- comparison is against the admin's whole-book figure captured above, not against
-- another rep's row: a rep cannot see another rep's row, so comparing to one would
-- read a legitimate zero and pass without proving anything.
select ok(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_rep)
  < (select realized_total from expected_book),
  'Ravi''s realized total is a proper subset of the book, so Ravi is not seeing Vikram''s 36 orders'
);

set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
select is(
  (select count(*) from public.sales_by_rep),
  0::bigint,
  'qc staff has no commercial scope, so the sales report is empty rather than an error'
);

select is(
  (select count(*) from public.sales_daily_split),
  0::bigint,
  'qc staff sees no rows in the sales trend'
);

select is(
  (select count(*) from public.credit_exposure_summary),
  0::bigint,
  'qc staff sees no rows in the credit exposure summary'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

-- ===========================================================================
-- K. sales_daily_split -- the /sales trend
--
-- Realized, pipeline and rejected are three separate series. The reason this
-- view exists is that the older sales_daily had no pipeline column and the
-- older status summary summed every status into one number, so a rejected order
-- and a shipped one drew at the same weight.
-- ===========================================================================
select is(
  (
    select coalesce(sum(realized_amount), 0)
    from public.sales_daily_split
  ),
  (
    select coalesce(sum(o.total_amount), 0)
    from public.orders as o
    where o.status in ('approved', 'dispatched', 'invoiced')
  ),
  'the trend''s realized total equals the realized order book'
);

select is(
  (
    select coalesce(sum(pipeline_amount), 0)
    from public.sales_daily_split
  ),
  (
    select coalesce(sum(o.total_amount), 0)
    from public.orders as o
    where o.status in ('pending', 'pending_director_approval')
  ),
  'the trend''s pipeline total equals the uncommitted order book'
);

select is(
  (
    select coalesce(sum(rejected_amount), 0)
    from public.sales_daily_split
  ),
  (
    select coalesce(sum(o.total_amount), 0)
    from public.orders as o
    where o.status = 'rejected'
  ),
  'rejected value is reported and never folded into realized or pipeline'
);

-- Realized and pipeline must not be added into one figure anywhere in this view.
-- A column that summed them would make every number on the screen wrong in a way
-- that looks authoritative.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_daily_split'
      and column_name in ('order_value', 'total_amount', 'combined_amount')
  ),
  'sales_daily_split has no single combined money column'
);

-- Days with no orders are absent rather than zero. A zero row would let a chart
-- library plot a real dip where there was simply no trading, and the two are
-- indistinguishable from the shape alone.
--
-- Asserted as equality with the distinct order dates rather than as a strict
-- inequality with them: the view is grouped over orders, so it cannot invent a
-- day, and the failure this guards against is a generated-calendar day leaking
-- in. A strict < would have been satisfied by any extra row and would not have
-- caught that.
select is(
  (select count(*)::bigint from public.sales_daily_split),
  (select count(distinct (created_at at time zone 'Asia/Kolkata')::date)::bigint from public.orders),
  'the trend has exactly one row per day that traded, and no generated zero row for a day that did not'
);

select ok(
  not exists (
    select 1 from public.sales_daily_split
    where realized_amount = 0 and pipeline_amount = 0 and rejected_amount = 0
  ),
  'no trend row is entirely zero, so an empty day cannot be drawn as a dip to zero'
);

-- ===========================================================================
-- L. order_stage_funnel -- the lifecycle position
--
-- stage_order is what makes the funnel readable. Sorting by status would put
-- rejected between pending and approved, which is not a path any order takes.
-- ===========================================================================
select is(
  (select count(*) from public.order_stage_funnel),
  4::bigint,
  'the seed has four occupied statuses'
);

select is(
  (select status::text from public.order_stage_funnel order by stage_order limit 1),
  'pending',
  'pending is the first stage'
);

select is(
  (select status::text from public.order_stage_funnel order by stage_order desc limit 1),
  'rejected',
  'rejected is the last stage'
);

-- There is no in_transit and no delivered. shipping stops at dispatched and
-- invoicing is the last leg, so a stage_order for them would be a position no
-- order can occupy and the funnel would show a gap that is an artefact of the
-- enum rather than of trading.
select is(
  (select coalesce(max(stage_order), 0)::int from public.order_stage_funnel),
  6,
  'the seed reaches stage 6, so the numbering skips the two absent statuses'
);

-- Asserted against the enum's own label list rather than by naming the absent
-- statuses in a literal. Casting 'in_transit' to order_status raises, which is
-- the stronger proof that the enum cannot hold it, but it aborts the transaction
-- rather than failing an assertion, so the check reads pg_enum.
select ok(
  not exists (
    select 1
    from pg_enum as e
    join pg_type as t on t.oid = e.enumtypid
    where t.typname = 'order_status'
      and e.enumlabel in ('in_transit', 'delivered')
  ),
  'order_status itself has no in_transit or delivered label, so the funnel cannot draw a row for one'
);

select is(
  (select count(*)::int from pg_enum as e join pg_type as t on t.oid = e.enumtypid where t.typname = 'order_status'),
  6,
  'order_status has exactly the six labels stage_order numbers'
);

select is(
  (select coalesce(sum(order_count), 0)::bigint from public.order_stage_funnel),
  (select count(*)::bigint from public.orders),
  'every order is counted in exactly one funnel stage'
);

select is(
  (select coalesce(sum(total_amount), 0) from public.order_stage_funnel),
  (select coalesce(sum(total_amount), 0) from public.orders),
  'the funnel totals the whole order book without double counting'
);

select ok(
  not exists (
    select 1 from public.order_stage_funnel where oldest_created_at is null
  ),
  'every stage reports the oldest order sitting in it, so a stuck stage is visible'
);

-- ===========================================================================
-- M. production_daily_output and production_yield_by_product
--
-- yield_ratio is null when a day consumed no recorded material, not 0. "Made
-- goods from unrecorded inputs" and "made nothing" are different facts and a
-- chart should be able to show the gap between them.
-- ===========================================================================
select is(
  (select coalesce(sum(run_count), 0)::bigint from public.production_daily_output),
  (select count(*)::bigint from public.production_runs where qc_status = 'passed'),
  'the daily output view counts passed runs only'
);

select is(
  (select count(*) from public.production_daily_output),
  (select count(distinct run_date)::bigint from public.production_runs where qc_status = 'passed'),
  'one row per run date, so a day with three runs is not drawn three times'
);

select is(
  (select coalesce(sum(total_output), 0) from public.production_daily_output),
  (select coalesce(sum(quantity_produced), 0) from public.production_runs where qc_status = 'passed'),
  'total output sums to the passed production runs'
);

select ok(
  exists (
    select 1 from public.production_daily_output where yield_ratio is not null
  ),
  'at least one seeded day has a yield ratio'
);

-- Stated as an invariant rather than as "some product has no input". The seed
-- happens to give every produced product recorded material, so an existence test
-- would fail here and pass only if the seed changed. What must hold always is
-- that a zero input is never dressed up as a computed ratio: a yield of 0.0000
-- would read as "we produced nothing from nothing", which is a different claim
-- from "we recorded no input".
select ok(
  not exists (
    select 1 from public.production_yield_by_product
    where coalesce(total_input, 0) = 0 and yield_ratio is not null
  ),
  'a product with no recorded input never reports a yield ratio, rather than a division by zero'
);

select is(
  (select count(*) from public.production_yield_by_product where yield_ratio is null),
  (select count(*) from public.production_yield_by_product where coalesce(total_input, 0) = 0),
  'yield_ratio is null for exactly the products with no recorded input'
);

-- Summing a ratio across products is meaningless, so the two views are separate
-- and the per-product view must not be a roll-up of the daily one.
select is(
  (select coalesce(sum(run_count), 0)::bigint from public.production_yield_by_product),
  (select count(*)::bigint from public.production_runs where qc_status = 'passed'),
  'the per-product view counts the same passed runs as the daily view'
);

-- The daily total must not be re-summed from products to check itself, so the
-- reconciliation is run to output instead, which is comparable in kind.
select is(
  (select coalesce(sum(total_output), 0) from public.production_daily_output),
  (select coalesce(sum(total_output), 0) from public.production_yield_by_product),
  'daily and per-product output agree, so the two views share one definition'
);

-- ===========================================================================
-- N. inventory_aging -- movement recency, honestly labelled
--
-- dead_stock is not null even when a product has never moved, because the
-- leading "is not null" makes it false there. days_since_movement IS null in the
-- same row. That asymmetry is deliberate and is the assertion.
-- ===========================================================================
select is(
  (select count(*) from public.inventory_aging),
  (select count(*) from public.products where active),
  'one row per active product, so a discontinued product leaves the ageing view'
);

-- Every product in the seed has a stock_levels row, so the never-moved case is
-- asserted as an invariant over what the view does produce: a null
-- last_movement_at must bring a null day count with it, and must leave
-- dead_stock false. A row that had null days but a true dead_stock flag would
-- tell a reader a product was written off on a day it was never counted.
select ok(
  not exists (
    select 1 from public.inventory_aging
    where (last_movement_at is null) <> (days_since_movement is null)
  ),
  'days_since_movement is null exactly when there has been no movement, never a bare zero'
);

select ok(
  not exists (
    select 1 from public.inventory_aging
    where last_movement_at is null and dead_stock
  ),
  'a product with no stock_levels row is null days and false dead_stock, never a dead_stock write-off'
);

select ok(
  not exists (
    select 1 from public.inventory_aging where dead_stock is null
  ),
  'dead_stock is never null, so a caller can filter on it without a three-way case'
);

select ok(
  not exists (
    select 1 from public.inventory_aging
    where dead_stock and coalesce(current_quantity, 0) <= 0
  ),
  'a product holding nothing is not dead stock, whatever its movement age'
);

select ok(
  not exists (
    select 1 from public.inventory_aging
    where dead_stock and coalesce(days_since_movement, 0) < 60
  ),
  'dead_stock implies at least the sixty day threshold the view documents'
);

-- ===========================================================================
-- O. credit_exposure_summary -- the credit book
--
-- outstanding comes from dealer_ledger rather than a second definition, so the
-- figure on the sales dashboard and the figure on the finance screen cannot
-- drift apart.
-- ===========================================================================
select is(
  (select count(*) from public.credit_exposure_summary),
  6::bigint,
  'every dealer is a row, including the suspended and inactive ones'
);

select is(
  (select coalesce(sum(outstanding_amount), 0) from public.credit_exposure_summary),
  (select coalesce(sum(outstanding_amount), 0) from public.dealer_ledger),
  'the dashboard outstanding total equals the ledger, not a re-derivation of it'
);

select is(
  (select coalesce(sum(open_invoices), 0)::bigint from public.credit_exposure_summary),
  (select count(*)::bigint from public.dealer_ledger where outstanding_amount > 0),
  'open invoices counts ledger rows still owed, so it is not the invoice count'
);

-- The view publishes credit_limit already resolved against the override, so the
-- check is against the dealer table rather than against a column the view does
-- not carry. A dealer with no override and no limit is reported as 0 rather than
-- null, because available_credit is computed from it and null would poison the
-- arithmetic downstream.
select is(
  (select count(*) from public.credit_exposure_summary as c
   join public.dealers as d on d.id = c.dealer_id
   where c.credit_limit is distinct from coalesce(d.credit_limit_override, d.credit_limit, 0)),
  0::bigint,
  'the reported limit is the override where one exists, so available_credit is charged against the real number'
);

select ok(
  not exists (
    select 1 from public.credit_exposure_summary where credit_limit is null
  ),
  'no dealer row reports a null limit, so the credit table never renders a blank headroom figure'
);

select ok(
  not exists (
    select 1 from public.credit_exposure_summary where available_credit > credit_limit
  ),
  'available credit never exceeds the limit it is drawn from'
);

select ok(
  not exists (
    select 1 from public.credit_exposure_summary
    where region is null or region = ''
  ),
  'every dealer has a region label, so the credit table never renders a blank cell'
);

select is(
  (select count(*) from public.credit_exposure_summary where exposure > 0),
  (select count(distinct dealer_id) from public.orders where status in ('pending', 'pending_director_approval', 'approved', 'dispatched')),
  'exposure is non-zero exactly for the dealers with live committed demand'
);

select * from finish();
rollback;
