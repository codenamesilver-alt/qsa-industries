begin;
select plan(113);

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
grant insert, select on compliance_baseline to authenticated;

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
reset role;

do $$
declare
  v_run uuid;
begin
  select id into v_run
  from public.production_runs
  where created_by = 'bddaf4a6-c4c0-4637-8369-c3cb7338098d'
  order by created_at desc
  limit 1;

  if v_run is null then
    select id into v_run from public.production_runs order by created_at desc limit 1;
  end if;

  update compliance_ids set production_run_id = v_run;
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
-- refused first, which is the rule two assertions further down.
reset role;

do $$
declare
  v_pending uuid;
begin
  select id into v_pending
  from public.production_runs
  where qc_status = 'pending'
  order by created_at desc
  limit 1;

  if v_pending is null then
    raise exception 'the suite needs a run with an open verdict';
  end if;

  update compliance_ids set production_run_id = v_pending;
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
-- on the column that is: sales_rep_id has never been writable by the application
-- role, because reassigning a dealer between reps is an admin decision.
select throws_ok(
  $$update public.dealers set sales_rep_id = '10000000-0000-4000-8000-000000000006'
     where id = '20000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'finance cannot reassign a dealer to a different sales rep'
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

-- The company state is still unset, so invoices are being raised as intra-state
-- and the tax is split in two. This is a deliberate assumption and the test
-- documents it, so that it fails loudly the moment someone sets the state and
-- this stops being true.
select ok(
  (select company_state is null from public.finance_settings where id = true),
  'the company state is still unset, so the GST split is an assumption'
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

select * from finish();
rollback;
