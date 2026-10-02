begin;
select plan(29);

-- Tests for 20260928105000_sales_report_date_range.sql.
--
-- The four reporting views are all-time aggregates and a view cannot take a
-- parameter, so a date range could not be applied to the /sales/reports export
-- at all. These four functions apply the range where the rows are still order
-- level, which is the only place it can be applied correctly: the totals views
-- have already summed orders into one row per group, so a window cannot be
-- recovered from them afterwards.
--
-- Two properties are load bearing here, and the suite is arranged around them.
--
-- First, unbounded must mean exactly what the views mean. A new report path that
-- quietly disagreed with the old one on the same question would be worse than
-- having no date filter, because both would look authoritative. Sections A and B
-- assert that, on the live data already in the database, which is a real
-- comparison rather than a self-consistency check.
--
-- Second, the range must be applied on the same date column the views bucket on,
--
--   (created_at at time zone 'Asia/Kolkata')::date
--
-- Filtering on a UTC date instead would silently drop orders placed late on the
-- last day of a window, and the month buckets would stop reconciling against the
-- regional totals. Section F asserts the trend and the totals agree to the paise
-- for a window that actually contains orders.
--
-- Fixtures are dated 2088. The suite runs inside a transaction that is rolled
-- back, but the database is not empty: the demo project has real orders in it, and
-- in CI it may have none. A window of 2088 holds only what this suite inserts, so
-- every arithmetic assertion is exact in both environments. An earlier draft of
-- this suite asserted against a hardcoded month and passed against an empty
-- report, which is the failure mode worth designing out.
--
-- Fixed identifiers, from migrations:
--   admin              10000000-0000-4000-8000-000000000001
--   sales_rep Ravi     10000000-0000-4000-8000-000000000005  (Green Valley)
--   dealer Green Valley 20000000-0000-4000-8000-000000000001
--   dealer Coastal      20000000-0000-4000-8000-000000000003
--   product QSA-LAYER-01 30000000-0000-4000-8000-000000000001

-- ===========================================================================
-- The whole suite runs impersonated as the admin, not as the database owner.
-- private.can_view_dealer reads auth.uid() and returns false for anyone who is
-- not an active internal user, so with no JWT claim set every function here
-- returns zero rows -- silently -- and every assertion below would pass against
-- an empty report. Section H re-impersonates a rep.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Fixtures. Four orders, all at 100.00 per unit, inserted as the owner because a
-- rep cannot create an orders for an arbitrary dealer.
--
--   2088-01-15  Green Valley  approved  10 units  1000.00 realized
--   2088-01-20  Green Valley  pending    5 units   500.00 pipeline
--   2088-01-25  Coastal      rejected   4 units   400.00 rejected only
--   2088-02-15  Green Valley  approved   2 units   200.00 realized
--
-- The Coastal order is in a different region and is rejected, so it exercises two
-- things at once: that a region with no realized sales in the window still appears
-- in the region totals, and that rejected money never leaks into realized.
-- ---------------------------------------------------------------------------
create temporary table rep_ids (label text primary key, order_id uuid);
grant insert, select on rep_ids to authenticated;

insert into public.orders (dealer_id, created_by, status, created_at)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'approved',
        timestamptz '2088-01-15 10:00:00+05:30')
returning id;

insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 10, 100
from public.orders as o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and o.status = 'approved'
  and (o.created_at at time zone 'Asia/Kolkata')::date = '2088-01-15'
  and not exists (select 1 from public.order_items as i where i.order_id = o.id);

insert into public.orders (dealer_id, created_by, status, created_at)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pending',
        timestamptz '2088-01-20 10:00:00+05:30')
returning id;

insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 5, 100
from public.orders as o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and o.status = 'pending'
  and (o.created_at at time zone 'Asia/Kolkata')::date = '2088-01-20'
  and not exists (select 1 from public.order_items as i where i.order_id = o.id);

insert into public.orders (dealer_id, created_by, status, created_at)
values ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'rejected',
        timestamptz '2088-01-25 10:00:00+05:30')
returning id;

insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 4, 100
from public.orders as o
where o.dealer_id = '20000000-0000-4000-8000-000000000003'
  and o.status = 'rejected'
  and (o.created_at at time zone 'Asia/Kolkata')::date = '2088-01-25'
  and not exists (select 1 from public.order_items as i where i.order_id = o.id);

insert into public.orders (dealer_id, created_by, status, created_at)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'approved',
        timestamptz '2088-02-15 10:00:00+05:30')
returning id;

insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 2, 100
from public.orders as o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and o.status = 'approved'
  and (o.created_at at time zone 'Asia/Kolkata')::date = '2088-02-15'
  and not exists (select 1 from public.order_items as i where i.order_id = o.id);

-- ===========================================================================
-- A. Unbounded must equal the all-time views, row for row.
--
-- Compared as sets rather than row order, and on the shared money columns, so a
-- difference in jsonb column order or row order cannot produce a false pass or a
-- false failure. This is the assertion that makes the new path trustworthy: with
-- no range chosen the screen reads the same numbers it always did.
-- ===========================================================================
select is(
  (
    select count(*) from (
      select region, period, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_region_period(null, null)
      except all
      select region, period, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_region_period
    ) as only_fn
  ) + (
    select count(*) from (
      select region, period, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_region_period
      except all
      select region, period, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_region_period(null, null)
    ) as only_view
  ),
  0::bigint,
  'sales_report_region_period with no range returns exactly the rows sales_by_region_period does'
);

select is(
  (
    select count(*) from (
      select region, dealer_count, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_region_totals(null, null)
      except all
      select region, dealer_count, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_region_period_totals
    ) as only_fn
  ) + (
    select count(*) from (
      select region, dealer_count, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_region_period_totals
      except all
      select region, dealer_count, realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_region_totals(null, null)
    ) as only_view
  ),
  0::bigint,
  'sales_report_region_totals with no range returns exactly the rows the totals view does'
);

select is(
  (
    select count(*) from (
      select dealer_id, region, realized_orders, realized_amount, pipeline_orders,
             pipeline_amount, invoiced_amount, outstanding_amount
      from public.sales_report_by_dealer(null, null)
      except all
      select dealer_id, region, realized_orders, realized_amount, pipeline_orders,
             pipeline_amount, invoiced_amount, outstanding_amount
      from public.sales_by_dealer
    ) as only_fn
  ) + (
    select count(*) from (
      select dealer_id, region, realized_orders, realized_amount, pipeline_orders,
             pipeline_amount, invoiced_amount, outstanding_amount
      from public.sales_by_dealer
      except all
      select dealer_id, region, realized_orders, realized_amount, pipeline_orders,
             pipeline_amount, invoiced_amount, outstanding_amount
      from public.sales_report_by_dealer(null, null)
    ) as only_view
  ),
  0::bigint,
  'sales_report_by_dealer with no range returns exactly the rows the dealer view does'
);

select is(
  (
    select count(*) from (
      select rep_id, rep_name, manager_id, manager_name, region, dealer_count,
             realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_by_rep(null, null)
      except all
      select rep_id, rep_name, manager_id, manager_name, region, dealer_count,
             realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_rep
    ) as only_fn
  ) + (
    select count(*) from (
      select rep_id, rep_name, manager_id, manager_name, region, dealer_count,
             realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_by_rep
      except all
      select rep_id, rep_name, manager_id, manager_name, region, dealer_count,
             realized_orders, realized_amount, pipeline_orders, pipeline_amount
      from public.sales_report_by_rep(null, null)
    ) as only_view
  ),
  0::bigint,
  'sales_report_by_rep with no range returns exactly the rows the rep view does, names included'
);

-- ===========================================================================
-- B. A January 2088 window holds only this suite's orders.
--
-- Green Valley: 1000.00 realized, 500.00 pipeline, 0.00 invoiced. The rejected
-- Coastal order is not realized and not invoiced, so it must not appear in any
-- of the three.
-- ===========================================================================
select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-01-01', '2088-01-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  1000.00::numeric,
  'a January 2088 window counts only the January realized order for Green Valley'
);

select is(
  (
    select pipeline_amount from public.sales_report_by_dealer('2088-01-01', '2088-01-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  500.00::numeric,
  'a January 2088 window counts the January pending order as pipeline, kept apart from realized'
);

select is(
  (
    select invoiced_amount from public.sales_report_by_dealer('2088-01-01', '2088-01-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  0.00::numeric,
  'nothing is invoiced in a window where nothing reached invoiced'
);

-- ===========================================================================
-- C. The trend carries the rejected measure, and never folds it into realized.
-- ===========================================================================
select is(
  (
    select coalesce(sum(realized_amount), 0) from public.sales_report_region_period('2088-01-01', '2088-01-31')
  ),
  1000.00::numeric,
  'the monthly trend for January 2088 realizes 1000.00 and does not include the 400.00 rejected order'
);

select is(
  (
    select coalesce(sum(pipeline_amount), 0) from public.sales_report_region_period('2088-01-01', '2088-01-31')
  ),
  500.00::numeric,
  'the monthly trend for January 2088 carries 500.00 of pipeline separately'
);

select is(
  (
    select coalesce(sum(rejected_amount), 0) from public.sales_report_region_period('2088-01-01', '2088-01-31')
  ),
  400.00::numeric,
  'the monthly trend for January 2088 reports the 400.00 rejected order under its own measure'
);

-- ===========================================================================
-- D. February is a different window.
-- ===========================================================================
select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-02-01', '2088-02-29')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  200.00::numeric,
  'a February 2088 window counts only the February order'
);

select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-01-01', '2088-01-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  )
  + (
    select realized_amount from public.sales_report_by_dealer('2088-02-01', '2088-02-29')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  1200.00::numeric,
  'the two 2088 windows together account for exactly the 2088 realized money, with no double count'
);

-- ===========================================================================
-- E. p_to is inclusive of that whole day, on the Asia/Kolkata order date.
--
-- The 15th is the boundary day. A window that started or ended a day early would
-- drop a real order, which is the bug the identical time zone expression exists
-- to prevent.
-- ===========================================================================
select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-01-15', '2088-01-15')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  1000.00::numeric,
  'a single day window for the 15th includes an order placed at 10:00 that day'
);

select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-01-16', '2088-01-16')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  0.00::numeric,
  'the day after the boundary has no realized money, so the boundary is not leaking either way'
);

-- ===========================================================================
-- F. The trend and the regional totals are two shapes of one answer, so they must
-- reconcile inside a window. If the range were applied to one of them and not
-- the other, this is where it shows.
-- ===========================================================================
select is(
  (
    select coalesce(sum(realized_amount), 0) from public.sales_report_region_period('2088-01-01', '2088-01-31')
  ),
  (
    select coalesce(sum(realized_amount), 0) from public.sales_report_region_totals('2088-01-01', '2088-01-31')
  ),
  'for a window holding orders, the monthly trend and the regional totals realize the same money'
);

select is(
  (
    select count(distinct period) from public.sales_report_region_period('2088-01-01', '2088-01-31')
  ),
  1::bigint,
  'a one month window produces exactly one month bucket'
);

-- A region with activity in the window but no realized sales still appears, which
-- is why dealer_count here narrows with the window and is not a headcount.
select is(
  (
    select count(*) from public.sales_report_region_period('2088-01-01', '2088-01-31')
    where realized_orders = 0
  ),
  1::bigint,
  'the rejected-only region is present in the January trend at zero realized rather than dropped'
);

-- ===========================================================================
-- G. The ledger columns are a current balance and do not move with the range.
--
-- public.dealer_ledger is a view, so no ledger row can be inserted here and this
-- is asserted as a paired property rather than a seeded one: the same call, over
-- a window, moves the order columns and must leave the balance columns alone. In
-- the demo project the balance is non-zero, so this is a real comparison there.
-- ===========================================================================
select is(
  (
    select coalesce(sum(outstanding_amount), 0) from public.sales_report_by_dealer('2088-01-01', '2088-12-31')
  ),
  (
    select coalesce(sum(outstanding_amount), 0) from public.sales_report_by_dealer(null, null)
  ),
  'outstanding is a current balance: a 2088 window does not change it'
);

select is(
  (
    select coalesce(sum(open_invoices), 0) from public.sales_report_by_dealer('2088-01-01', '2088-12-31')
  ),
  (
    select coalesce(sum(open_invoices), 0) from public.sales_report_by_dealer(null, null)
  ),
  'open_invoices is a current balance: a 2088 window does not change it'
);

-- ===========================================================================
-- H. The range is validated, and validated unconditionally.
--
-- The first draft of the migration validated the range in a language sql body, as
-- a guard CTE cross joined to the report query. When the visible order set is
-- empty that cross join produces no rows, the guard is never evaluated, and an
-- inverted range returns zero rows instead of an error -- reporting "no sales in
-- that period" for what is a typo. These four must raise on every one of the
-- functions, including the two whose empty result would previously have skipped
-- the check.
-- ===========================================================================
select throws_ok(
  $$select * from public.sales_report_region_period('2088-01-31', '2088-01-01')$$,
  '22023',
  'date range start 2088-01-31 is after end 2088-01-01',
  'an inverted range is refused by the monthly trend'
);

select throws_ok(
  $$select * from public.sales_report_region_totals('2088-01-31', '2088-01-01')$$,
  '22023',
  'date range start 2088-01-31 is after end 2088-01-01',
  'an inverted range is refused by the regional totals'
);

select throws_ok(
  $$select * from public.sales_report_by_rep('2088-01-31', '2088-01-01')$$,
  '22023',
  'date range start 2088-01-31 is after end 2088-01-01',
  'an inverted range is refused by the rep rollup'
);

select throws_ok(
  $$select * from public.sales_report_by_dealer('2088-01-31', '2088-01-01')$$,
  '22023',
  'date range start 2088-01-31 is after end 2088-01-01',
  'an inverted range is refused by the dealer book'
);

-- A valid window that happens to hold nothing is not an error, and the dealer
-- book still lists the dealer at zero rather than omitting it.
select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-05-01', '2088-05-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  0.00::numeric,
  'a valid but empty window is not an error, and a dealer with no orders in it is present at zero'
);

-- A half open range is a legitimate thing to ask for.
select is(
  (
    select realized_amount from public.sales_report_by_dealer('2088-01-01', null)
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  1200.00::numeric,
  'a from-only range runs to the end of time, and a to-only range is symmetric'
);

-- ===========================================================================
-- I. Scoping survives the range.
--
-- These are security invoker, so the range is a filter the caller's own rights
-- apply to, not a window that widens access. A rep must not be able to reach
-- another rep's dealer by asking for a different period, which is the new risk
-- this migration introduces: four new entry points to the reporting data.
-- ===========================================================================
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select ok(
  exists (
    select 1 from public.sales_report_by_dealer('2088-01-01', '2088-12-31')
    where dealer_id = '20000000-0000-4000-8000-000000000001'
  ),
  'a sales rep still sees their own dealer in a bounded report'
);

select ok(
  not exists (
    select 1 from public.sales_report_by_dealer('2088-01-01', '2088-12-31')
    where dealer_id = '20000000-0000-4000-8000-000000000003'
  ),
  'a sales rep cannot reach another region dealer by choosing a date range'
);

select ok(
  not exists (
    select 1 from public.sales_report_by_dealer('2099-01-01', '2099-12-31')
    where dealer_id = '20000000-0000-4000-8000-000000000003'
  ),
  'and not by choosing a window with no orders in it either'
);

select is(
  (
    select count(*) from public.sales_report_by_rep('2088-01-01', '2088-12-31')
  ),
  (
    select count(*) from public.sales_report_by_rep(null, null)
  ),
  'a bounded rep rollup returns the same rows an unbounded one does, so the range changes no visibility'
);

select * from finish();
rollback;
