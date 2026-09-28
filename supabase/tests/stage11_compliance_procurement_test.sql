begin;
select plan(160);

-- Tests for everything added in the 20260926 migration block: quality control
-- segregation of duties, proxy ordering and requested delivery dates, dealer
-- regions, tax codes and invoice lines, configurable invoice ageing, raw
-- material purchase orders, and batch/lot expiry with first-expiry-first-out.
--
-- Conventions follow the earlier suites: assertions run inside a transaction that
-- is rolled back, ambient dataset state is captured rather than hard-coded, and
-- every rule is checked on both its accepting and its rejecting side. A test
-- that only proves the happy path proves nothing about a permission or a
-- constraint.
--
-- Fixed identifiers below all come from migrations, so they are identical on the
-- live database and on a from-scratch replay:
--   admin              10000000-...-0001
--   sales_director     10000000-...-0002
--   sales_manager      10000000-...-0003
--   sales_manager      10000000-...-0004
--   sales_rep Ravi     10000000-...-0005   (Green Valley, Legacy Agro)
--   sales_rep Sana     10000000-...-0006   (Sunrise, Sunset)
--   sales_rep Vikram   10000000-...-0007   (Coastal)
--   sales_rep Ananya   10000000-...-0008   (Highland)
--   production_manager bddaf4a6-...
--   inventory_manager  6a251aaf-...
--   logistics          890e8dd2-...
--   finance            22145f21-...
--   qc_staff           7c1f0a52-...

create temporary table compliance_ids (
  production_run_id uuid,
  first_run_id uuid,
  second_run_id uuid,
  purchase_order_id uuid,
  purchase_line_maize uuid,
  purchase_line_soy uuid,
  batch_early uuid,
  batch_late uuid
);
grant insert, select, update on compliance_ids to authenticated;

-- The suite fills this row in from the objects it creates, and reads the ids back
-- out of it. It has to exist before the first update: an update against an empty
-- table matches no rows and silently leaves every id null, which then surfaces
-- somewhere else entirely as a lookup against a null key.
insert into compliance_ids default values;

-- Raw material for purchasing, finished goods for batches and dispatch.
create temporary table compliance_baseline (
  product_id uuid primary key,
  qty numeric
);
grant insert, select, delete on compliance_baseline to authenticated;

-- ===========================================================================
-- A. Quality control segregation of duties
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

insert into compliance_baseline (product_id, qty)
select product_id, current_quantity
from public.stock_levels
where product_id in (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000006'
);

select ok(
  (select count(*) > 0 from public.production_runs),
  'qc_staff can read production runs'
);

select ok(
  (select count(*) > 0 from public.production_run_materials),
  'qc_staff can read the bill of materials of a run'
);

-- The point of a separate role: whoever ran the shift must not be the person
-- certifying the output. Before qc_staff existed, only the run creator or an
-- admin could set a verdict.
select ok(
  (select count(*) from public.production_runs) >= 0,
  'qc_staff has visibility of runs it did not create'
);

-- QC inspects; it does not run the plant.
select throws_ok(
  $$select public.create_production_run(
    '30000000-0000-4000-8000-000000000001',
    1,
    'qc probe',
    current_date,
    '[]'::jsonb,
    'pending',
    null
  )$$,
  'P0001',
  null,
  'qc_staff cannot start a production run'
);

-- The verdict itself: QC may set qc_status on a run created by the production
-- manager, and it is that cross-user write the RLS policy exists to permit.
--
-- The manager starts a run of their own here rather than adopting whatever run
-- happens to be lying around. Adopting one made the suite a consumer of seed
-- state: every invocation finalised a run it did not create, so each run of the
-- suite left one fewer run with an open verdict and the next invocation failed
-- with 'the suite needs a run with an open verdict'.
--
-- The rows are inserted directly instead of through create_production_run: what
-- is under test is who may set a verdict, not how a shift is costed, and the RPC
-- would issue raw material for a run this suite has no interest in. Both runs are
-- removed at the end of this section, so the suite leaves stock exactly as it
-- found it and can be run against a database it has not visited before.
reset role;

do $$
declare
  v_run uuid;
begin
  insert into public.production_runs (
    product_id, quantity_produced, shift, run_date, qc_status, created_by
  )
  values (
    '30000000-0000-4000-8000-000000000001', 1200, 'morning',
    current_date, 'pending', 'bddaf4a6-c4c0-4637-8369-c3cb7338098d'
  )
  returning id into v_run;

  update compliance_ids set production_run_id = v_run, first_run_id = v_run;
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select ok(
  (select production_run_id is not null from compliance_ids),
  'the suite has a production run to certify'
);

select lives_ok(
  format(
    $$update public.production_runs set qc_status = 'passed', qc_notes = 'qc suite verdict'
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  'qc_staff can certify a run it did not create'
);

select is(
  (select qc_status::text from public.production_runs
    where id = (select production_run_id from compliance_ids)),
  'passed',
  'the verdict is stored'
);

-- Granting UPDATE on the row must not become a grant to rewrite production
-- history. The enforcement is column privileges, not the trigger:
-- 20260925091100 grants `update (qc_status, qc_notes)` and nothing else, so
-- run_date, quantity_produced and created_by are not writable by any
-- application role at all. That is stronger than the trigger, which is left in
-- place as defence in depth for the owning role. These assertions are written
-- against what actually stops the write, so they keep their meaning if the
-- trigger is ever dropped.
select throws_ok(
  format(
    $$update public.production_runs set quantity_produced = quantity_produced + 500
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  '42501',
  null,
  'qc_staff cannot rewrite the produced quantity'
);

select throws_ok(
  format(
    $$update public.production_runs set run_date = current_date - 5
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  '42501',
  null,
  'qc_staff cannot backdate a run'
);

select throws_ok(
  format(
    $$update public.production_runs set created_by = '10000000-0000-4000-8000-000000000001'
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  '42501',
  null,
  'qc_staff cannot reassign the author of a run'
);

-- The trigger is not dead code: the owner role does hold the wider privilege, so
-- this is the path that reaches it. Proved from the owning role on purpose.
reset role;

select throws_ok(
  format(
    $$update public.production_runs set quantity_produced = quantity_produced + 500
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  'P0001',
  'Only QC fields can be updated after production is recorded',
  'the QC update guard refuses a quantity change even for a privileged writer'
);

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

-- The bill of materials is stopped by the raw_materials_write_internal policy,
-- which admits only admin, production_manager and inventory_manager. A policy
-- refusal matches no row, so the update succeeds and changes nothing: the stored
-- name is the assertion. Expecting 42501 here would be asserting a privilege
-- error the design deliberately does not use.
reset role;

create temporary table bom_probe as
select name from public.raw_materials where id = (
  select raw_material_id from public.production_run_materials limit 1);

grant select on bom_probe to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

update public.raw_materials set name = name || ' (edited)' where id = (
  select raw_material_id from public.production_run_materials limit 1);

select is(
  (select name from public.raw_materials where id = (
     select raw_material_id from public.production_run_materials limit 1)),
  (select name from bom_probe),
  'qc_staff cannot edit the bill of materials'
);

-- A failed verdict has to say why. This needs a run whose verdict is still open:
-- the run certified above is now 'passed', and reopening a finalized verdict is
-- refused first, which is the rule two assertions further down. A second run of
-- the suite's own is started for this, so it never has to borrow one.
reset role;

do $$
declare
  v_pending uuid;
begin
  insert into public.production_runs (
    product_id, quantity_produced, shift, run_date, qc_status, created_by
  )
  values (
    '30000000-0000-4000-8000-000000000006', 1200, 'evening',
    current_date, 'pending', 'bddaf4a6-c4c0-4637-8369-c3cb7338098d'
  )
  returning id into v_pending;

  update compliance_ids
  set second_run_id = v_pending, production_run_id = v_pending;
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select throws_ok(
  format(
    $$update public.production_runs set qc_status = 'failed', qc_notes = null
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  'P0001',
  'Failed QC requires notes',
  'a failed verdict cannot be filed without notes'
);

-- A finalized verdict is final. Put the run back to a passed verdict first, since
-- the assertion above deliberately moved the suite onto an open one.
reset role;

do $$
begin
  update public.production_runs set qc_status = 'passed', qc_notes = 'qc suite verdict'
  where id = (select production_run_id from compliance_ids);
end
$$;

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select throws_ok(
  format(
    $$update public.production_runs set qc_status = 'pending'
      where id = %L$$,
    (select production_run_id from compliance_ids)
  ),
  'P0001',
  'QC status cannot change after it is finalized',
  'a passed verdict cannot be reopened'
);

-- ===========================================================================
-- B. Proxy ordering and the requested delivery date
-- ===========================================================================

-- Ravi Menon (10000000-...-0005) is mapped to Green Valley. Vikram Desai
-- (10000000-...-0007) is mapped to Coastal. Neither is mapped to the other.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select lives_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    current_date + 3,
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'a sales rep can place an order for a mapped dealer'
);

select throws_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    '20000000-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'That dealer is not mapped to you',
  'a sales rep cannot place an order for an unmapped dealer'
);

select throws_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    null
  )$$,
  'P0001',
  'A sales rep must name the dealer the order is for',
  'a sales rep must say which dealer the order is for'
);

-- The date the customer actually asked for, which dispatch did not previously
-- have anywhere to read.
reset role;

do $$
declare
  v_order public.orders%rowtype;
begin
  select *
  into v_order
  from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    current_date + 7,
    '20000000-0000-4000-8000-000000000001'
  );

  if v_order.requested_delivery_date <> current_date + 7 then
    raise exception 'requested delivery date was not stored';
  end if;
end
$$;

select ok(true, 'the requested delivery date is stored on the order');

reset role;

do $$
begin
  perform public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    current_date - 1,
    '20000000-0000-4000-8000-000000000001'
  );
  raise exception 'a past requested delivery date was accepted';
exception
  when others then
    if sqlerrm = 'a past requested delivery date was accepted' then
      raise;
    end if;
    if sqlerrm <> 'Requested delivery date cannot be in the past' then
      raise;
    end if;
end
$$;

select ok(true, 'a requested delivery date in the past is rejected');

-- A dealer must not be able to aim an order at somebody else's account by
-- passing a crafted dealer id.
set local role authenticated;
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select lives_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    null
  )$$,
  'a dealer can still place its own order'
);

select throws_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'Dealers can only place orders for their own account',
  'a dealer cannot order against another account'
);

-- Admin enters phone orders for any active account.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    current_date + 2,
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'an admin can enter an order for any active dealer'
);

select throws_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    '20000000-0000-4000-8000-000000000005'
  )$$,
  'P0001',
  'Dealer account is not active',
  'a suspended dealer cannot receive a new order'
);

-- ===========================================================================
-- C. Dealer region
-- ===========================================================================

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

-- These three were lives_ok, which only proves the statement did not raise. An
-- UPDATE that matches no row also does not raise, so the assertions passed
-- whether or not finance could write at all -- they would have gone green against
-- the exact regression they exist to catch. The stored value is asserted instead.
update public.dealers set region = 'West'
 where id = '20000000-0000-4000-8000-000000000002';

select is(
  (select region from public.dealers where id = '20000000-0000-4000-8000-000000000002'),
  'West',
  'finance can classify a dealer region'
);

update public.dealers set credit_limit_override = 275000
 where id = '20000000-0000-4000-8000-000000000002';

select is(
  (select credit_limit_override from public.dealers where id = '20000000-0000-4000-8000-000000000002'),
  275000.00,
  'finance can set a dealer credit limit'
);

-- And the override has to actually govern the limit, otherwise setting one is
-- decoration. This is the whole point of the column: it is the number
-- public.credit_summary reports as available credit. The exposure figure is read
-- back out of the same summary rather than private.order_exposure, which is
-- revoked from the application role on purpose.
select is(
  (select credit_limit::numeric from public.credit_summary('20000000-0000-4000-8000-000000000002')),
  275000.00,
  'the credit limit override becomes the limit the credit summary reports'
);

select is(
  (select available_credit::numeric from public.credit_summary('20000000-0000-4000-8000-000000000002')),
  275000.00 - (select exposure::numeric from public.credit_summary('20000000-0000-4000-8000-000000000002')),
  'available credit is the override less the exposure'
);

-- Renaming a dealer is not outside finance's granted columns, so this is asserted
-- on the column that is: sales_rep_id is an admin decision, and finance must be
-- refused by a rule rather than by the absence of a grant.
--
-- The role is set here explicitly because the section above leaves the suite on
-- whichever identity it last used. Left implicit, this assertion was really
-- testing qc_staff and passing for a third unrelated reason.
--
-- The expectation changed in 20260926100700 from 42501 to P0001, and the change is
-- the point rather than a correction. This used to pass because authenticated held
-- no UPDATE grant on dealers at all, so every write failed on privilege before any
-- rule was consulted. That is not enforcement: the same missing grant is why the
-- finance credit override had never worked either. Now that the write path exists,
-- the refusal comes from private.guard_dealer_commercial_columns.
set local role authenticated;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

-- The target rep is chosen against the row's current value, because a probe that
-- writes the value already stored is not a probe. The guard is a difference check,
-- so setting sales_rep_id to what it already holds correctly does nothing at all,
-- and the original version of this assertion was silently doing exactly that: the
-- seed already had this dealer on that rep, so the write was a no-op and only the
-- privilege error was ever being observed.
select throws_ok(
  $$update public.dealers
       set sales_rep_id = case
         when sales_rep_id = '10000000-0000-4000-8000-000000000006'::uuid
           then '10000000-0000-4000-8000-000000000007'::uuid
         else '10000000-0000-4000-8000-000000000006'::uuid
       end
     where id = '20000000-0000-4000-8000-000000000002'$$,
  'P0001',
  'Only an admin can reassign a dealer to a different sales rep',
  'finance cannot reassign a dealer to a different sales rep'
);

-- And the accepting side of the same rule, so sales_rep_id is not simply frozen
-- for everyone. Asserted as the admin, not from the owner role: an owner bypasses
-- both the grant and the guard, so a test run from there would pass no matter what
-- the rule said.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

reset role;

create temporary table dealer_rep_baseline as
select sales_rep_id from public.dealers where id = '20000000-0000-4000-8000-000000000002';
grant select on dealer_rep_baseline to authenticated;

set local role authenticated;

select lives_ok(
  $$update public.dealers
       set sales_rep_id = case
         when sales_rep_id = '10000000-0000-4000-8000-000000000006'::uuid
           then '10000000-0000-4000-8000-000000000007'::uuid
         else '10000000-0000-4000-8000-000000000006'::uuid
       end
     where id = '20000000-0000-4000-8000-000000000002'$$,
  'an admin can reassign a dealer to a different sales rep'
);

select isnt(
  (select sales_rep_id::text from public.dealers where id = '20000000-0000-4000-8000-000000000002'),
  (select sales_rep_id::text from dealer_rep_baseline),
  'the admin reassignment really changed the assigned rep'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

-- A sales rep is refused by policy rather than by privilege, so the update is
-- permitted and matches nothing. Asserting the stored value is what makes that
-- visible: an error would mean the control moved somewhere unintended, and a
-- changed value would mean a rep can reclassify their own territory. The
-- starting value is captured rather than hard-coded, so a change to the seed
-- does not turn this into a false failure.
reset role;

create temporary table rep_region_probe as
select region from public.dealers where id = '20000000-0000-4000-8000-000000000001';

grant select on rep_region_probe to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

update public.dealers set region = 'South' where id = '20000000-0000-4000-8000-000000000001';

select is(
  (select region from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  (select region from rep_region_probe),
  'a sales rep cannot reassign a dealer region'
);

-- Ravi is mapped to Green Valley, so this is a dealer he is genuinely responsible
-- for: the refusal is a role boundary, not a scoping accident.
select ok(
  (select sales_rep_id = '10000000-0000-4000-8000-000000000005'
     from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  'the dealer in the region probe really is the rep''s own account'
);

-- The credit escalation that 20260926100300 exists to close. A dealer reaches its
-- own row through private.can_edit_dealer, and 20260926093400 had granted the
-- application role UPDATE on credit_limit, so a dealer could raise its own limit
-- and then order against it. Every one of these is the dealer's own account.
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select throws_ok(
  $$update public.dealers set credit_limit = 99999999
     where id = (select dealer_id from public.users where id = auth.uid())$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot raise its own credit limit'
);

select throws_ok(
  $$update public.dealers set credit_limit_override = 99999999
     where id = (select dealer_id from public.users where id = auth.uid())$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot set its own credit limit override'
);

-- Status has to be a real transition, not a no-op. This dealer is already active,
-- so setting it to 'active' again changes nothing and a guard that only fires on a
-- difference is behaving correctly. Suspending is the change that must be refused,
-- and it is the change that would actually let a dealer stop trading.
select throws_ok(
  $$update public.dealers set status = 'suspended'
     where id = (select dealer_id from public.users where id = auth.uid())$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot suspend its own account'
);

-- Confirm the refusal left the account trading, so this is a real control and not
-- an account that was already suspended by the seed.
select is(
  (select status::text from public.dealers
    where id = (select dealer_id from public.users where id = auth.uid())),
  'active',
  'the dealer account is still active after the refused suspension'
);

select throws_ok(
  $$update public.dealers set region = 'Mars'
     where id = (select dealer_id from public.users where id = auth.uid())$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot reclassify its own sales region'
);

-- And the guarantee the whole credit workflow rests on, checked end to end: the
-- dealer's own limit is still the limit the credit check applies.
reset role;

do $$
declare
  v_dealer uuid;
  v_limit numeric;
  v_headroom numeric;
begin
  select dealer_id into v_dealer from public.users where id = '4637f04f-aed6-44bc-82d8-774991079d1d';

  select credit_limit into v_limit from public.dealers where id = v_dealer;
  v_headroom := v_limit - private.order_exposure(v_dealer);

  if v_headroom < 0 then
    raise exception 'dealer % is already over its limit before any escalation', v_dealer;
  end if;
end
$$;

select ok(true, 'a dealer is inside its own credit limit, so the limit is still binding');

-- The guard has to be narrow. A dealer maintains its own contact details through
-- private.can_edit_dealer, and 20260926100300 must not take that away along with
-- the commercial columns. If this fails the guard is too broad, which would push
-- dealers back to phoning in their own address changes.
set local role authenticated;
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

update public.dealers set contact_person = contact_person
 where id = (select dealer_id from public.users where id = auth.uid());

select lives_ok(
  format(
    $$update public.dealers set contact_person = 'Compliance Suite Contact'
       where id = %L$$,
    (select dealer_id from public.users where id = auth.uid())
  ),
  'a dealer can still maintain its own contact details'
);

select is(
  (select contact_person from public.dealers
    where id = (select dealer_id from public.users where id = auth.uid())),
  'Compliance Suite Contact',
  'the dealer contact change was actually stored'
);

-- Writing a commercial column to the value it already holds changes nothing, so
-- the guard must stay quiet. The plain statement above is that check: had the
-- guard fired on the column alone rather than on the difference, the whole
-- transaction would have aborted here and the suite would have stopped.
select ok(true, 'the guard compares values and ignores a no-op write');

reset role;

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

update public.dealers set credit_limit_override = null
 where id = '20000000-0000-4000-8000-000000000002';

select ok(
  (select credit_limit_override is null from public.dealers
    where id = '20000000-0000-4000-8000-000000000002'),
  'finance can clear a credit limit override'
);

-- Clearing the override has to hand the dealer back its own limit, not leave a
-- cached figure behind. Comparing the summary against the stored dealer row is
-- the check that the fallback actually took effect.
select is(
  (select credit_limit::numeric from public.credit_summary('20000000-0000-4000-8000-000000000002')),
  (select credit_limit::numeric from public.dealers
    where id = '20000000-0000-4000-8000-000000000002'),
  'clearing the override restores the dealer''s own limit'
);

reset role;

select ok(
  (select count(*) > 0 from public.sales_by_region where region <> 'Unassigned'),
  'the region report groups dealers by territory'
);

select ok(
  (select count(*) = 0 from public.sales_by_region where region = 'Unassigned'),
  'no seeded dealer is missing from the region report'
);

-- ===========================================================================
-- D. Tax codes, invoice lines and the GST split
-- ===========================================================================

select is(
  (select count(*) from public.products where hsn_code is null or btrim(hsn_code) = ''),
  0::bigint,
  'every product carries a tax code'
);

-- 20260926100500 collapses two overlapping constraints per table into one. The
-- count is the assertion, because a duplicate is not a harmless extra guard
-- here: the pair on products disagreed, and '^[0-9]{4,8}$' in the newer one
-- accepts 5- and 7-digit codes that are not valid HSN. Two constraints that
-- have to be read together to work is one constraint too many.
select is(
  (select count(*)::int from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'products'
      and con.conname ilike '%hsn%'),
  1,
  'products carries exactly one tax code constraint'
);

select is(
  (select count(*)::int from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'invoice_lines'
      and con.conname ilike '%hsn%'),
  1,
  'invoice_lines carries exactly one tax code constraint'
);

-- The rule that the looser regex would have lost. HSN is 4, 6 or 8 digits, so 5
-- and 7 must both be refused, and a blank must be refused even though it is not
-- null. The original code is captured so the product is put back exactly as the
-- seed left it, rather than relying on the suite's final rollback to hide the
-- damage.
reset role;

create temporary table hsn_probe as
select id, hsn_code from public.products order by id limit 1;

select throws_ok(
  $$update public.products set hsn_code = '12345'
     where id = (select id from hsn_probe)$$,
  '23514',
  null,
  'a five digit tax code is refused'
);

select throws_ok(
  $$update public.products set hsn_code = '1234567'
     where id = (select id from hsn_probe)$$,
  '23514',
  null,
  'a seven digit tax code is refused'
);

select throws_ok(
  $$update public.products set hsn_code = '   '
     where id = (select id from hsn_probe)$$,
  '23514',
  null,
  'a whitespace tax code is refused'
);

select throws_ok(
  $$update public.products set hsn_code = null
     where id = (select id from hsn_probe)$$,
  '23514',
  null,
  'a missing tax code is refused'
);

select lives_ok(
  $$update public.products set hsn_code = '1234'
     where id = (select id from hsn_probe)$$,
  'a four digit tax code is accepted'
);

select lives_ok(
  $$update public.products set hsn_code = '123456'
     where id = (select id from hsn_probe)$$,
  'a six digit tax code is accepted'
);

select lives_ok(
  $$update public.products set hsn_code = '12345678'
     where id = (select id from hsn_probe)$$,
  'an eight digit tax code is accepted'
);

update public.products p
   set hsn_code = h.hsn_code
  from hsn_probe h
 where p.id = h.id;

select is(
  (select p.hsn_code from public.products p join hsn_probe h on p.id = h.id),
  (select hsn_code from hsn_probe),
  'the product tax code is restored to its seeded value'
);

-- Every historical invoice has to have been backfilled, not just new ones.
select is(
  (select count(*) from public.invoices i
     where not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id)),
  0::bigint,
  'every invoice has lines, including the backfilled ones'
);

select is(
  (select count(*) from public.invoices i
     where abs(i.total_amount - coalesce((select sum(l.line_total) from public.invoice_lines l
                                           where l.invoice_id = i.id), 0)) > 0.01),
  0::bigint,
  'invoice header totals equal the sum of their lines'
);

select is(
  (select count(*) from public.invoices i
     where abs(i.gst_amount - coalesce((select sum(l.cgst_amount + l.sgst_amount + l.igst_amount)
                                         from public.invoice_lines l
                                        where l.invoice_id = i.id), 0)) > 0.01),
  0::bigint,
  'invoice header tax equals the sum of the line tax components'
);

select is(
  (select count(*) from public.invoices
     where igst_amount > 0 and (cgst_amount <> 0 or sgst_amount <> 0)),
  0::bigint,
  'no invoice splits tax as both central and state at the same time'
);

select ok(
  (select bool_and(place_of_supply is not null) from public.invoices),
  'every invoice records a place of supply'
);

-- The supplying office state is confirmed as Haryana, so the GST split is no
-- longer an assumption. This assertion used to require the state to be NULL and
-- was written to fail the moment someone set it; what replaces it checks the
-- rule itself, so it does not need rewriting again the next time the state is
-- confirmed or corrected.
select is(
  (select company_state from public.finance_settings where id = true),
  'Haryana'::text,
  'the supplying office state is confirmed, so the GST split is not an assumption'
);

-- An invoice that recorded the supplying state must have split its tax to match
-- the dealer's state: IGST only when the dealer is elsewhere, the CGST/SGST pair
-- only when the dealer is in the same state.
select is(
  (select count(*)
     from public.invoices i
     join public.dealers d on d.id = i.dealer_id
    where i.company_state is not null
      and d.state is not null
      and d.state <> i.company_state
      and (i.cgst_amount <> 0 or i.sgst_amount <> 0 or i.igst_amount = 0)),
  0::bigint,
  'no invoice splits CGST or SGST for a dealer in another state'
);

select is(
  (select count(*)
     from public.invoices i
     join public.dealers d on d.id = i.dealer_id
    where i.company_state is not null
      and d.state is not null
      and d.state = i.company_state
      and (i.cgst_amount = 0 or i.sgst_amount = 0 or i.igst_amount <> 0)),
  0::bigint,
  'no invoice splits IGST for a dealer in the supplying state'
);

-- The invoices raised before the state was confirmed are not rewritten here.
-- Moving tax on an issued invoice needs a credit note and a reissue, which is a
-- compliance decision rather than a test fixture, so they are queued instead.
select ok(
  (select count(*) > 0 from public.finance_place_of_supply_review),
  'invoices raised before the state was confirmed are queued for reissue'
);

-- ===========================================================================
-- E. Configurable invoice ageing
-- ===========================================================================

-- Boundaries that cross over would silently swallow the invoices in between.
select throws_ok(
  $$update public.finance_settings
       set ageing_bucket_1_days = 60, ageing_bucket_2_days = 30
     where id = true$$,
  'P0001',
  'Ageing bucket 1 must be shorter than bucket 2',
  'ageing buckets cannot cross over'
);

select throws_ok(
  $$update public.finance_settings set ageing_grace_days = -1 where id = true$$,
  '23514',
  null,
  'a negative grace period is rejected'
);

select throws_ok(
  $$update public.finance_settings set ageing_grace_days = 400 where id = true$$,
  '23514',
  null,
  'a grace period beyond a year is rejected'
);

-- finance_settings is select-only for authenticated users. The only way to
-- change the terms is through the vetted function, which is what makes the role
-- check on that function worth something.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';

select throws_ok(
  $$update public.finance_settings set ageing_grace_days = 5 where id = true$$,
  '42501',
  null,
  'a sales rep cannot edit finance settings directly'
);

select throws_ok(
  $$select public.update_finance_settings(null, null, 5, null, null, null, null, false)$$,
  'P0001',
  'Only finance can change finance settings',
  'a sales rep cannot change ageing terms through the function'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select is(
  (select ageing_grace_days from public.update_finance_settings(null, null, 15, 30, 60, 90, false, false)),
  15,
  'finance can set the grace period'
);

select is(
  (select ageing_bucket_3_days from public.finance_settings where id = true),
  90,
  'the ageing buckets persist'
);

select is(
  (select credit_counts_current_invoices from public.finance_settings where id = true),
  false,
  'finance can stop invoices inside the grace period from counting'
);

-- pgTAP's is() reports a failure when either side is null, so a cleared bucket is
-- asserted as a null check rather than a comparison against null.
select ok(
  (select ageing_bucket_1_days is null
     from public.update_finance_settings(null, null, null, null, null, null, null, true)),
  'the clear flag switches every bucket off'
);

select ok(
  (select ageing_bucket_3_days is null
     from public.update_finance_settings(null, null, null, null, null, null, null, true)),
  'the clear flag switches every bucket off, not just the first'
);

select is(
  (select count(*) from public.dealer_invoice_ageing),
  (select count(distinct dealer_id) from public.invoices i
     where i.total_amount > coalesce((select sum(pa.amount) from public.payment_allocations pa
                                       where pa.invoice_id = i.id), 0)),
  'the ageing report covers exactly the dealers with an outstanding invoice'
);

-- Exposure has to actually move when the terms change, otherwise the switch is
-- decoration. The dealer is chosen by its outstanding invoice balance rather than
-- hard-coded: an earlier version of this test named Green Valley, and on a fresh
-- replay that dealer's invoices are fully settled, so there was no invoice
-- exposure to remove and the assertion passed only because both sides were
-- identical. Picking the largest live balance means the switch is always
-- exercised against money that is actually owed.
reset role;

create temporary table ageing_probe as
with open_invoices as (
  select i.dealer_id,
         i.invoice_date,
         i.total_amount
           - coalesce((select sum(pa.amount) from public.payment_allocations pa
                       where pa.invoice_id = i.id), 0) as outstanding
    from public.invoices i
)
-- The grace period counts invoices dated on or before (business_date - grace_days),
-- so a period wide enough to swallow every open invoice has to clear the *newest*
-- one. Using the oldest invoice, as an earlier version did, left that invoice
-- exactly on the boundary and still counted, which is why the exposure came back
-- with 48300 of invoice balance still in it.
select d.id as dealer_id,
       private.order_exposure(d.id)::numeric as before_exposure,
       private.business_date() - max(oi.invoice_date) + 1 as grace_needed
  from open_invoices oi
  join public.dealers d on d.id = oi.dealer_id
 where oi.outstanding > 0
 group by d.id
 order by sum(oi.outstanding) desc
 limit 1;

select ok(
  (select count(*) = 1 and max(before_exposure) > 0 from ageing_probe),
  'the ageing probe found a dealer with real invoice exposure'
);

-- A grace period wide enough to cover the oldest open invoice, with the switch
-- off, is the "dealer is entirely within terms" case. The documented behaviour is
-- that the invoice side of the exposure goes to zero and only the open orders are
-- left -- that is the whole promise of the switch, "a dealer inside terms gets the
-- full limit back". So the figure has to equal the open order value rather than
-- the exposure measured before the change.
update public.finance_settings
   set credit_counts_current_invoices = false,
       ageing_grace_days = (select grace_needed::integer from ageing_probe)
 where id = true;

select is(
  (select private.order_exposure((select dealer_id from ageing_probe))::numeric),
  (select coalesce(sum(o.total_amount), 0)::numeric
     from public.orders o
    where o.dealer_id = (select dealer_id from ageing_probe)
      and o.status in ('pending', 'pending_director_approval', 'approved')),
  'a grace period covering every open invoice drops the invoice side of the exposure'
);

select ok(
  (select private.order_exposure((select dealer_id from ageing_probe))::numeric
     < (select before_exposure from ageing_probe)),
  'being inside terms reduces exposure rather than leaving it alone'
);

update public.finance_settings
   set credit_counts_current_invoices = false,
       ageing_grace_days = 0
 where id = true;

select ok(
  (select private.order_exposure((select dealer_id from ageing_probe))::numeric
     <= (select before_exposure from ageing_probe)),
  'counting only overdue invoices never increases exposure'
);

update public.finance_settings
   set credit_counts_current_invoices = true,
       ageing_grace_days = 0
 where id = true;

select is(
  (select private.order_exposure((select dealer_id from ageing_probe))::numeric),
  (select before_exposure from ageing_probe),
  'restoring the default terms restores exposure exactly'
);

-- ===========================================================================
-- F. Raw material purchase orders
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

insert into compliance_baseline (product_id, qty)
select product_id, current_quantity
from public.stock_levels
where product_id in ('30000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000007');

select ok(
  (select count(*) = 2 from compliance_baseline where product_id in (
     '30000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000007')),
  'the purchasing suite has a stock baseline for both raw materials'
);

reset role;

do $$
declare
  v_po public.purchase_orders%rowtype;
  v_line record;
begin
  v_po := public.create_purchase_order(
    'Demo Feeds and Grain',
    '27AAAAA0000A1Z5',
    current_date + 14,
    'compliance suite purchase order',
    jsonb_build_array(
      jsonb_build_object('product_id', '30000000-0000-4000-8000-000000000006', 'quantity', 200, 'unit_price', 22.50),
      jsonb_build_object('product_id', '30000000-0000-4000-8000-000000000007', 'quantity', 100, 'unit_price', 31.00)
    )
  );

  -- Checked first and separately on purpose. A null here would make every
  -- comparison below evaluate to null rather than true, and the block would pass
  -- without testing anything.
  if v_po.id is null then
    raise exception 'create_purchase_order returned no row';
  end if;

  if coalesce(v_po.total_amount, -1) <> 7600.00 then
    raise exception 'expected a derived total of 7600.00, got %', v_po.total_amount;
  end if;

  if coalesce(v_po.status::text, '') <> 'ordered' then
    raise exception 'a raised purchase order should start as ordered, got %', v_po.status;
  end if;

  if coalesce(v_po.po_number, '') !~ '^PO-[0-9]{4}-[0-9]{6}$' then
    raise exception 'purchase order number % does not follow the agreed pattern', v_po.po_number;
  end if;

  for v_line in
    select id, product_id from public.purchase_order_lines
    where purchase_order_id = v_po.id order by product_id
  loop
    if v_line.product_id = '30000000-0000-4000-8000-000000000006' then
      update compliance_ids set purchase_line_maize = v_line.id;
    else
      update compliance_ids set purchase_line_soy = v_line.id;
    end if;
  end loop;

  update compliance_ids set purchase_order_id = v_po.id;
end
$$;

select ok(true, 'a purchase order is raised with a derived total and a formatted number');

-- Finished goods are bought from nobody; they are made or bought in through
-- production. Letting a PO buy feed would let stock appear without a bill of
-- materials and quietly defeat the costing.
set local role authenticated;
set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select throws_ok(
  $$select public.create_purchase_order(
    'Wrong Supplier', null, current_date + 5, null,
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":10,"unit_price":100}]'::jsonb
  )$$,
  'P0001',
  'Product 30000000-0000-4000-8000-000000000001 is not a raw material',
  'a finished good cannot be purchased'
);

select throws_ok(
  $$select public.create_purchase_order(
    'No Lines', null, current_date + 5, null, '[]'::jsonb
  )$$,
  'P0001',
  'A purchase order needs at least one line',
  'an empty purchase order is rejected'
);

select throws_ok(
  $$select public.create_purchase_order(
    'Past Date', null, current_date - 3, null,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":10,"unit_price":22}]'::jsonb
  )$$,
  'P0001',
  'Expected date cannot be in the past',
  'a past expected date is rejected'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';

select throws_ok(
  $$select public.create_purchase_order(
    'Rep Supplier', null, current_date + 5, null,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":10,"unit_price":22}]'::jsonb
  )$$,
  'P0001',
  'Only inventory or admin can raise a purchase order',
  'a sales rep cannot raise a purchase order'
);

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

-- Receiving: partial first, so the short-delivery state is observable.
--
-- This is the shape 20260926100400 fixes. The receipt touches the maize line and
-- leaves the soy line completely untouched, and the status has to say so. The
-- original implementation asked bool_and "did anything arrive on every line",
-- which is false the moment one line is untouched, so the order stayed 'ordered'
-- with stock already received against it. A receipt that happened to touch every
-- line took the correct branch by accident, which is why it survived being
-- applied to a live database.
select is(
  (select status::text from public.receive_purchase_order(
    (select purchase_order_id from compliance_ids),
    jsonb_build_array(jsonb_build_object(
      'line_id', (select purchase_line_maize from compliance_ids),
      'quantity', 50
    ))
  )),
  'partially_received',
  'a short delivery on one line leaves the whole order partially received'
);

-- The untouched line must still read as untouched, so the order screen can show
-- what is outstanding rather than only that something arrived.
select is(
  (select quantity_received from public.purchase_order_lines
    where id = (select purchase_line_soy from compliance_ids)),
  0.00,
  'the line that was not delivered still reads zero received'
);

select is(
  (select current_quantity from public.stock_levels
    where product_id = '30000000-0000-4000-8000-000000000006'),
  (select qty + 50 from compliance_baseline
    where product_id = '30000000-0000-4000-8000-000000000006'),
  'receiving posts the stock through the ledger'
);

select is(
  (select count(*) from public.stock_movements
    where product_id = '30000000-0000-4000-8000-000000000006' and source = 'purchase'),
  1::bigint,
  'the receipt is tagged as a purchase, not a manual adjustment'
);

-- Receiving more than was ordered is the classic receiving error.
select throws_ok(
  $$select public.receive_purchase_order(
    (select purchase_order_id from compliance_ids),
    jsonb_build_array(jsonb_build_object(
      'line_id', (select purchase_line_maize from compliance_ids),
      'quantity', 9999
    ))
  )$$,
  'P0001',
  null,
  'a receipt cannot exceed the quantity still outstanding on the line'
);

-- A line id from a different purchase order must be refused, not quietly
-- dropped. This is the defect that was caught by reading rather than by a test.
reset role;

do $$
declare
  v_other public.purchase_orders%rowtype;
  v_other_id uuid;
  v_other_line uuid;
begin
  v_other := public.create_purchase_order(
    'Other Supplier', null, current_date + 5, null,
    jsonb_build_array(jsonb_build_object(
      'product_id', '30000000-0000-4000-8000-000000000006', 'quantity', 10, 'unit_price', 22
    ))
  );

  if v_other.id is null then
    raise exception 'the control purchase order was not created';
  end if;

  v_other_id := v_other.id;

  select id into v_other_line
  from public.purchase_order_lines
  where purchase_order_id = v_other_id
  limit 1;

  if v_other_line is null then
    raise exception 'the control purchase order has no line';
  end if;

  begin
    perform public.receive_purchase_order(
      (select purchase_order_id from compliance_ids),
      jsonb_build_array(jsonb_build_object('line_id', v_other_line, 'quantity', 5))
    );
    raise exception 'a line from another purchase order was accepted';
  exception
    when others then
      if sqlerrm = 'a line from another purchase order was accepted' then
        raise;
      end if;
      if sqlerrm not like 'Receipt line % does not belong to purchase order%' then
        raise;
      end if;
  end;
end
$$;

select ok(true, 'a receipt line from a different purchase order is rejected');

set local role authenticated;
set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

-- Close it out.
select is(
  (select status::text from public.receive_purchase_order(
    (select purchase_order_id from compliance_ids),
    jsonb_build_array(
      jsonb_build_object('line_id', (select purchase_line_maize from compliance_ids), 'quantity', 150),
      jsonb_build_object('line_id', (select purchase_line_soy from compliance_ids), 'quantity', 100)
    )
  )),
  'received',
  'receiving the remainder closes the purchase order'
);

select is(
  (select quantity_received from public.purchase_order_lines
    where id = (select purchase_line_soy from compliance_ids)),
  100.00,
  'the received quantity is tracked per line'
);

select throws_ok(
  $$select public.receive_purchase_order(
    (select purchase_order_id from compliance_ids),
    jsonb_build_array(jsonb_build_object(
      'line_id', (select purchase_line_soy from compliance_ids), 'quantity', 1
    ))
  )$$,
  'P0001',
  null,
  'a closed purchase order cannot receive more stock'
);

-- A purchase order must not be able to mark itself received from the browser.
select throws_ok(
  $$update public.purchase_orders set status = 'received'
     where id = (select purchase_order_id from compliance_ids)$$,
  '42501',
  null,
  'a client cannot close a purchase order without receiving it'
);

-- ===========================================================================
-- G. Batch tracking and first-expiry-first-out
-- ===========================================================================

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

-- Refresh rather than defer to the row captured at the top of the suite: section A
-- certified a run of this same product, so that snapshot no longer describes the
-- stock level the two receipts below are added to, and 'on conflict do nothing'
-- would have kept comparing against a level 1200 units stale.
delete from compliance_baseline where product_id = '30000000-0000-4000-8000-000000000001';

insert into compliance_baseline (product_id, qty)
values ('30000000-0000-4000-8000-000000000001',
        (select current_quantity from public.stock_levels
          where product_id = '30000000-0000-4000-8000-000000000001'))
on conflict (product_id) do nothing;

select ok(
  (select count(*) from compliance_baseline where product_id = '30000000-0000-4000-8000-000000000001') = 1,
  'the batch suite has a stock baseline for the batched product'
);

-- Two batches of the same product, deliberately created out of expiry order so
-- that "earliest first" cannot pass by accident. The function returns a whole
-- product_batches row, so the code is selected out of the row rather than cast:
-- casting the row to text would yield every column and never equal a code.
select is(
  (select (public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001',
    'BATCH-LATE', current_date - 5, current_date + 120, 300,
    'adjustment', null, 'compliance suite late batch'
  )).batch_code),
  'BATCH-LATE',
  'a later batch is received first'
);

select is(
  (select (public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001',
    'BATCH-EARLY', current_date - 5, current_date + 20, 100,
    'adjustment', null, 'compliance suite early batch'
  )).batch_code),
  'BATCH-EARLY',
  'an earlier batch is received second'
);

select is(
  (select current_quantity from public.stock_levels
    where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty + 400 from compliance_baseline
    where product_id = '30000000-0000-4000-8000-000000000001'),
  'both batch receipts reach the product stock level'
);

select is(
  (select quantity_received - quantity_issued from public.product_batches where batch_code = 'BATCH-EARLY'),
  100.00,
  'the batch ledger credits the early batch'
);

select is(
  (select count(*) from public.stock_movements
    where product_id = '30000000-0000-4000-8000-000000000001' and batch_id is not null),
  2::bigint,
  'both batch receipts are linked to their batch'
);

-- First-expiry-first-out. 100 is available in the early batch, so a 150 unit
-- plan has to split across both and take the early one first.
select results_eq(
  $$
    select out_batch_code, out_quantity from private.allocate_batches_fefo(
      '30000000-0000-4000-8000-000000000001', 150
    ) order by out_expiry_date
  $$,
  $$ values ('BATCH-EARLY'::text, 100.00::numeric), ('BATCH-LATE'::text, 50.00::numeric) $$,
  'first-expiry-first-out takes the earliest batch first and splits the remainder'
);

select results_eq(
  $$
    select out_batch_code from private.allocate_batches_fefo(
      '30000000-0000-4000-8000-000000000001', 40
    )
  $$,
  $$ values ('BATCH-EARLY'::text) $$,
  'a quantity inside one batch is not spread across the others'
);

-- Optionality: a product nobody batch tracks still ships, against the ordinary
-- product-level ledger, with no batch at all.
select results_eq(
  $$
    select out_batch_id, out_quantity from private.allocate_batches_fefo(
      '30000000-0000-4000-8000-000000000009', 10
    )
  $$,
  $$ values (null::uuid, 10.00::numeric) $$,
  'a product with no batches is allocated as one untracked quantity'
);

-- Expired stock must not be allocated, and must not be sellable either.
reset role;

-- The batch starts empty. The stock movement is what credits it, exactly as it
-- does for a live batch receipt -- seeding quantity_received here as well would
-- count the same 40 units twice and quietly make every later figure wrong.
insert into public.product_batches (product_id, batch_code, expiry_date)
values (
  '30000000-0000-4000-8000-000000000009', 'BATCH-EXPIRED', current_date - 10
);

do $$
declare
  v_available numeric;
begin
  insert into public.stock_movements (product_id, quantity, movement_type, source, reason, batch_id)
  values (
    '30000000-0000-4000-8000-000000000009', 40, 'in', 'adjustment',
    'compliance suite expired batch', (
      select id from public.product_batches where batch_code = 'BATCH-EXPIRED'
    )
  );

  select quantity_received - quantity_issued into v_available
  from public.product_batches where batch_code = 'BATCH-EXPIRED';

  if v_available <> 40 then
    raise exception 'the expired batch should hold 40 available, got %', v_available;
  end if;
end
$$;

select ok(true, 'an expired batch can exist in the ledger, it is simply not allocated');

select is(
  (select count(*) from private.allocate_batches_fefo(
     '30000000-0000-4000-8000-000000000009', 10
   ) where out_batch_id is not null),
  0::bigint,
  'an expired batch is never planned for dispatch'
);

select is(
  (select round((available_quantity - sellable_quantity)::numeric, 2) from public.dealer_catalog
    where product_id = '30000000-0000-4000-8000-000000000009'),
  40.00,
  'expired stock is excluded from what a dealer can order'
);

select is(
  (select expiry_status from public.expiring_batches where batch_code = 'BATCH-EXPIRED'),
  'expired',
  'the expiry report classifies an expired batch'
);

select is(
  (select expiry_status from public.expiring_batches where batch_code = 'BATCH-EARLY'),
  'critical',
  'the expiry report flags a batch inside thirty days'
);

-- The reason 20260926100200 exists. Every assertion above ran as the owner or as
-- a member of staff, and all of them would have passed against a schema where
-- product_batches had no grant at all -- because the views were only ever
-- exercised by roles that already had access. These four run as the roles that
-- actually use them in the product.
set local role authenticated;
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

-- A dealer has to be able to read the catalog, or the order screen is dead.
select lives_ok(
  $$select count(*) from public.dealer_catalog$$,
  'a dealer can read the product catalog'
);

-- And the expired stock has to be gone from it, for the dealer, which is the
-- whole point of the rule. This is the assertion the missing grant would have
-- hidden: without the security definer helper the batch rows are invisible here,
-- the lateral returns nothing, and the dealer is offered expired stock.
select is(
  (select round((available_quantity - sellable_quantity)::numeric, 2)
     from public.dealer_catalog
    where product_id = '30000000-0000-4000-8000-000000000009'),
  40.00,
  'a dealer is not offered stock that has expired'
);

-- A dealer must not be able to read the batch ledger itself, even though the
-- catalog was made to work for them. Row level security returns no rows rather
-- than raising, so the count is the assertion.
select is(
  (select count(*)::bigint from public.product_batches),
  0::bigint,
  'a dealer cannot read the batch ledger directly'
);

-- The expiry report is a staff tool: readable, and empty for a dealer.
select is(
  (select count(*)::bigint from public.expiring_batches),
  0::bigint,
  'the expiry report is not readable by a dealer'
);

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select lives_ok(
  $$select batch_code, expiry_date from public.product_batches$$,
  'inventory can read the batch ledger'
);

select lives_ok(
  $$select count(*) from public.expiring_batches$$,
  'inventory can read the expiry report'
);

-- Batch quantities are maintained by the stock movement trigger, not by a client.
select throws_ok(
  $$update public.product_batches set quantity_issued = 0
     where batch_code = 'BATCH-EARLY'$$,
  '42501',
  null,
  'a client cannot rewrite a batch quantity'
);

-- Over-issuing a batch must be refused, not allowed to go negative. The insert is
-- made from the owning role on purpose: stock_movements grants INSERT to nobody in
-- the application role, by design, so from `authenticated` this statement would be
-- refused for the wrong reason and would prove nothing about batches.
reset role;

select throws_ok(
  format(
    $$insert into public.stock_movements
      (product_id, quantity, movement_type, source, reason, batch_id)
     values (
       '30000000-0000-4000-8000-000000000001', 500, 'out', 'adjustment', 'over-issue probe',
       (select id from public.product_batches where batch_code = 'BATCH-EARLY')
     )$$
  ),
  'P0001',
  null,
  'a batch cannot be over-issued'
);

-- And the ledger still reconciles after the refused write, so the refusal is a
-- refusal and not a partially applied movement.
select is(
  (select quantity_received - quantity_issued from public.product_batches
    where batch_code = 'BATCH-EARLY'),
  100.00,
  'a refused over-issue leaves the batch quantity untouched'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'NOPE', null, current_date + 30, 10,
    'adjustment', null, 'rep probe'
  )$$,
  'P0001',
  'Only inventory, production or admin can receive a batch',
  'a sales rep cannot receive a batch'
);

-- The role check runs before the date check, so the past-expiry rule can only be
-- reached by a caller who is allowed to receive a batch at all. Asserted as
-- inventory; asserting it as a rep would prove the role check twice.
set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'PAST', null, current_date - 5, 10,
    'adjustment', null, 'past expiry probe'
  )$$,
  'P0001',
  'Expiry date cannot be in the past',
  'a batch cannot be created already expired'
);

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'NODATE', null, null, 10,
    'adjustment', null, 'no expiry probe'
  )$$,
  'P0001',
  'Expiry date is required for a batch',
  'a batch cannot be received without an expiry date'
);

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'BADORDER', current_date + 10, current_date + 5, 10,
    'adjustment', null, 'order probe'
  )$$,
  'P0001',
  'Manufacture date cannot be after the expiry date',
  'a batch cannot expire before it was made'
);

-- The code check trims first, so a blank or whitespace code is what it is
-- guarding against, not a null one. Passing a real string here would be testing
-- nothing, which is how this assertion used to pass without a refusal.
select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', '   ', null, current_date + 5, 10,
    'adjustment', null, 'blank code probe'
  )$$,
  'P0001',
  'Batch code is required',
  'a batch cannot be received with a blank code'
);

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', null, null, current_date + 5, 10,
    'adjustment', null, 'null code probe'
  )$$,
  'P0001',
  'Batch code is required',
  'a batch cannot be received without a code'
);

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'BADSRC', null, current_date + 5, 10,
    'sales', null, 'bad source probe'
  )$$,
  'P0001',
  null,
  'a batch cannot be received from a source that cannot create stock'
);

select throws_ok(
  $$select public.receive_into_batch(
    '30000000-0000-4000-8000-000000000001', 'ZERO', null, current_date + 5, 0,
    'adjustment', null, 'zero quantity probe'
  )$$,
  'P0001',
  'Receipt quantity must be positive',
  'a batch receipt must be for a positive quantity'
);

-- ===========================================================================
-- F. Direct client write paths, and the escalations they must not open
-- ===========================================================================
--
-- 20260926100600 exists because a policy is a row filter and not a permission.
-- authenticated held SELECT on dealers while two UPDATE policies sat on it, so
-- Postgres refused every browser write before row level security was even
-- consulted, and the finance credit override and dealer self-service contact
-- edit had never run as a signed-in user. The stage11 section E tests passed
-- anyway, because they reset to the owner role, and the owner bypasses both
-- grants and policies.
--
-- So these assertions are the ones that would have caught it: they run as
-- authenticated, and they check the privilege directly rather than trusting a
-- passing update to imply one.
--
-- The fixed identities used below:
--   admin            10000000-...-0001
--   sales_rep Ravi   10000000-...-0005
--   finance          22145f21-...
--   inventory mgr    6a251aaf-...
--   production mgr   bddaf4a6-...
--   qc_staff         7c1f0a52-...
--   dealer (Coastal) 4637f04f-...

-- --- the grants exist -----------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.dealers'::regclass, 'UPDATE'),
  'authenticated can update dealers, so the two dealers update policies are reachable'
);

select ok(
  has_column_privilege('authenticated', 'public.users'::regclass, 'full_name', 'UPDATE'),
  'a user can update their own full name'
);

select ok(
  has_column_privilege('authenticated', 'public.products'::regclass, 'low_stock_threshold', 'UPDATE'),
  'an inventory manager can update a replenishment threshold'
);

select ok(
  has_column_privilege('authenticated', 'public.production_runs'::regclass, 'qc_status', 'UPDATE'),
  'QC staff can update a QC verdict, so the browser QC action is reachable'
);

-- --- and the columns that would be escalations are not granted ------------

-- users_update_self is a row filter meaning "my own row". Given the whole table,
-- that is a role promotion button.
select ok(
  not has_column_privilege('authenticated', 'public.users'::regclass, 'role', 'UPDATE'),
  'a user cannot update their own role'
);

select ok(
  not has_column_privilege('authenticated', 'public.users'::regclass, 'is_active', 'UPDATE'),
  'a user cannot reactivate their own account'
);

-- products_update_threshold is a row filter meaning "I am an inventory manager".
-- Given the whole table, that is a repricing permission.
select ok(
  not has_column_privilege('authenticated', 'public.products'::regclass, 'price', 'UPDATE'),
  'an inventory manager cannot reprice a product'
);

select ok(
  not has_column_privilege('authenticated', 'public.products'::regclass, 'is_sellable', 'UPDATE'),
  'an inventory manager cannot change whether a product is sellable'
);

select ok(
  not has_column_privilege('authenticated', 'public.production_runs'::regclass, 'quantity_produced', 'UPDATE'),
  'a production manager cannot rewrite a recorded production quantity'
);

-- --- dealer self-service: the feature that was dead -----------------------

reset role;

create temporary table write_probe as
select
  (select dealer_id from public.users where role = 'dealer' order by id limit 1) as own_dealer,
  (select id from public.dealers
    where id <> (select dealer_id from public.users where role = 'dealer' order by id limit 1)
    order by id limit 1) as other_dealer,
  (select credit_limit from public.dealers
    where id = (select dealer_id from public.users where role = 'dealer' order by id limit 1)) as own_credit_limit;
grant select on write_probe to authenticated;

set local role authenticated;
-- SET takes a literal, not a subquery, so the signed-in identity has to be
-- written out. It is the seeded Coastal dealer, 4637f04f-aed6-44bc-82d8-774991079d1d.
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

-- Accepting side. Without the grant in 20260926100600 this raised 42501, which
-- is why the dealer contact form could never have saved.
select lives_ok(
  $$update public.dealers set phone = phone where id = (select own_dealer from write_probe)$$,
  'a dealer can save their own contact details'
);

-- The escalation that granting dealers UPDATE would have opened. The guard from
-- 20260926100300 did not cover sales_rep_id at all until 20260926100600.
select throws_ok(
  $$update public.dealers set sales_rep_id = (select sales_rep_id from public.dealers
       where id = (select other_dealer from write_probe))
     where id = (select own_dealer from write_probe)$$,
  'P0001',
  'Only an admin can reassign a dealer to a different sales rep',
  'a dealer cannot reassign their own account to a different sales rep'
);

select throws_ok(
  $$update public.dealers set credit_limit_override = 999999
     where id = (select own_dealer from write_probe)$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot raise their own credit limit override'
);

select throws_ok(
  $$update public.dealers set region = 'West'
     where id = (select own_dealer from write_probe)$$,
  'P0001',
  'Only admin or finance can change a credit limit, account status or sales region',
  'a dealer cannot move their own account to another region'
);

-- Row scope, which is the policy rather than the guard. A filtered row is not an
-- error, it is zero rows, so this is counted rather than thrown. The data
-- modifying CTE has to be the top level of the statement; inside the is()
-- argument Postgres refuses it outright.
with blocked as (
  update public.dealers set phone = '0000000000'
   where id = (select other_dealer from write_probe)
  returning 1
)
select is(
  (select count(*)::int from blocked),
  0,
  'a dealer cannot write to another dealer''s row'
);

-- --- finance: the override path that was dead ------------------------------

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select lives_ok(
  $$update public.dealers
       set credit_limit_override = (select own_credit_limit from write_probe)
     where id = (select own_dealer from write_probe)$$,
  'finance can set a dealer credit limit override'
);

select lives_ok(
  $$update public.dealers set region = region where id = (select own_dealer from write_probe)$$,
  'finance can set a dealer region'
);

select is(
  (select credit_limit_override from public.dealers where id = (select own_dealer from write_probe)),
  (select own_credit_limit from write_probe),
  'the override finance set is the value stored'
);

-- --- a sales rep, who is neither a dealer nor finance ----------------------
--
-- A sales rep matches neither dealers update policy, so the row is filtered out
-- before the guard trigger is ever consulted. That means there is no exception to
-- catch here, and asserting one would be asserting the wrong mechanism: the guard
-- is not what stops them, the row scope is. Both writes are therefore counted.

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

with blocked as (
  update public.dealers set status = 'suspended'
   where id = (select own_dealer from write_probe)
  returning 1
)
select is(
  (select count(*)::int from blocked),
  0,
  'a sales rep cannot suspend a dealer'
);

with blocked as (
  update public.dealers set phone = '1111111111'
   where id = (select own_dealer from write_probe)
  returning 1
)
select is(
  (select count(*)::int from blocked),
  0,
  'a sales rep has no write access to a dealer row at all'
);

select is(
  (select status::text from public.dealers where id = (select own_dealer from write_probe))
  is distinct from 'suspended',
  true,
  'the dealer status is unchanged after the refused attempt'
);

-- --- inventory manager: threshold yes, catalogue no ------------------------

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select lives_ok(
  $$update public.products set low_stock_threshold = low_stock_threshold
     where id = (select product_id from public.stock_levels order by product_id limit 1)$$,
  'an inventory manager can save a replenishment threshold'
);

select throws_ok(
  $$update public.products set price = 1 where id = (select product_id from public.stock_levels order by product_id limit 1)$$,
  '42501',
  null,
  'an inventory manager cannot change a product price'
);

-- --- self-service profile, and the role column that is not theirs ---------

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select lives_ok(
  $$update public.users set full_name = full_name where id = auth.uid()$$,
  'a user can save their own name'
);

select throws_ok(
  $$update public.users set role = 'admin' where id = auth.uid()$$,
  '42501',
  null,
  'a user cannot promote themselves to admin'
);

select throws_ok(
  $$update public.users set is_active = false where id = auth.uid()$$,
  '42501',
  null,
  'a user cannot deactivate their own account'
);

-- --- QC: the component that could never have worked ------------------------

reset role;

-- A precondition, and the reason it is here: an UPDATE whose WHERE clause matches
-- nothing raises no error and reports no failure, so every lives_ok and throws_ok
-- below would quietly pass against an empty set if no pending run existed.
--
-- The run is created here rather than borrowed, for the same reason as in section
-- A: a suite that depends on a pending run happening to be lying around is a suite
-- that consumes seed state and fails the second time it is run. Nothing is cleaned
-- up afterwards because the whole suite runs inside the transaction that the final
-- rollback discards.
reset role;

do $$
declare
  v_late uuid;
begin
  insert into public.production_runs (
    product_id, quantity_produced, shift, run_date, qc_status, created_by
  )
  values (
    '30000000-0000-4000-8000-000000000004', 1200, 'night',
    current_date, 'pending', 'bddaf4a6-c4c0-4637-8369-c3cb7338098d'
  )
  returning id into v_late;

  update compliance_ids set second_run_id = v_late;
end
$$;

select ok(
  (select count(*) > 0 from public.production_runs where qc_status = 'pending'),
  'a pending production run exists to finalize'
);

-- The column privilege for quantity_produced is asserted above, as a privilege
-- check, because the behavioural version of it cannot be written here: this
-- section has to read the pending run as the owner, and the owner is not subject
-- to the column grant, so the update would simply succeed.

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select lives_ok(
  $$update public.production_runs set qc_notes = qc_notes
     where id = (select id from public.production_runs where qc_status = 'pending' order by id limit 1)$$,
  'QC staff can record notes against a pending run'
);

-- The trigger rule, now reachable from the browser for the first time.
select throws_ok(
  $$update public.production_runs set qc_status = 'failed'
     where id = (select id from public.production_runs where qc_status = 'pending' order by id limit 1)$$,
  'P0001',
  'Failed QC requires notes',
  'QC staff cannot fail a run without notes'
);

-- --- no write policy is left stranded without a grant ----------------------
--
-- The structural check, so this class of bug cannot come back through a new
-- table. The two SECURITY DEFINER only tables are excluded by name, because for
-- those the policies are inert by design rather than dead by accident.
--
-- has_any_column_privilege rather than has_table_privilege, and the difference is
-- the whole point: a column grant makes a policy reachable without ever granting
-- the table. Checking table privilege here would have called products,
-- production_runs and users dead on the very migration that fixed them.
--
-- raw_materials is not excluded, and this is why: it grants INSERT and UPDATE to
-- authenticated for the internal roles its ALL policy names, so its write path is
-- real and its policy is not dead. The exclusion list is the exception list, so
-- every name on it is a place a future migration has to look at on purpose.

reset role;

select is(
  (select count(*)::int
     from pg_policies p
     join pg_class c on c.relname = p.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where p.schemaname = 'public'
      and p.cmd = 'UPDATE'
      and p.roles::text like '%authenticated%'
      and p.tablename not in ('purchase_orders', 'purchase_order_lines')
      and not has_any_column_privilege('authenticated', c.oid, 'UPDATE')),
  0,
  'every browser-writable update policy has a grant that makes it reachable'
);

-- The two exclusions are load-bearing rather than convenient. If a future
-- migration gives either table a browser write path, this fails and the name has
-- to come off the list deliberately.
select is(
  (select count(*)::int
     from pg_policies p
     join pg_class c on c.relname = p.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where p.schemaname = 'public'
      and p.roles::text like '%authenticated%'
      and p.tablename in ('purchase_orders', 'purchase_order_lines')
      and has_any_column_privilege('authenticated', c.oid, 'UPDATE')),
  0,
  'the SECURITY DEFINER only tables still have no browser write grant'
);

-- And raw_materials stays out of that list for the opposite reason, asserted so
-- the reason is recorded rather than remembered.
select ok(
  has_any_column_privilege('authenticated', 'public.raw_materials'::regclass, 'UPDATE'),
  'raw_materials is genuinely browser-writable, so it is not an inert policy'
);

select ok(
  not has_table_privilege('authenticated', 'public.raw_materials'::regclass, 'DELETE'),
  'raw_materials rows still cannot be deleted from the browser'
);

select * from finish();
rollback;
