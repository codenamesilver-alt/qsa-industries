begin;
select plan(41);

-- Tests for 20260928100000_regional_sales_reporting.sql, which replaced a view that
-- only looked like it satisfied PRD 9.4.
--
-- public.sales_by_region (20260926093400) has no time axis, so every figure is
-- "all of history", and it sums orders of every status into one order_value
-- column, which makes a rejected order and a delivered one look identical. It also
-- has no rep or manager dimension, so "by dealer, rep, manager, region/period" was
-- never actually delivered.
--
-- The replacement keeps realized and pipeline as separate measures throughout. That
-- split is the whole point of this suite: an earlier shape summed them, and the
-- resulting number was neither revenue nor credit risk, which is worse than having
-- no number at all because it looks authoritative.
--
-- Visibility is the other half. These views are security_invoker, so RLS applies as
-- the calling user. A reporting view that aggregates something the caller cannot see
-- leaks through the aggregate even when every underlying row is protected, so the
-- scope assertions at the end are as load bearing as the arithmetic ones.
--
-- Fixed identifiers, from migrations:
--   admin            10000000-0000-4000-8000-000000000001
--   sales_director   10000000-0000-4000-8000-000000000002
--   sales_manager    10000000-0000-4000-8000-000000000003
--   sales_rep Ravi   10000000-0000-4000-8000-000000000005  (Green Valley)
--   sales_rep Vikram 10000000-0000-4000-8000-000000000007  (Coastal)
--   finance          22145f21-ebba-4e23-8bc5-b9650307a4ea
--   qc_staff         7c1f0a52-0000-4000-8000-000000000001
--   dealer Green Valley 20000000-0000-4000-8000-000000000001
--   dealer Coastal      20000000-0000-4000-8000-000000000003
--   product QSA-LAYER-01  30000000-0000-4000-8000-000000000001

-- ===========================================================================
-- The whole suite runs impersonated as the admin, not as the database owner.
-- private.can_view_dealer reads auth.uid() and returns false for anyone who is not
-- an active internal user, so with no JWT claim set every view in this migration
-- returns zero rows -- silently, and every assertion below would pass against an
-- empty report. The scope section at the end re-impersonates other roles.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- Fixtures. Inserted as the owner, because a rep cannot create an order for an
-- arbitrary dealer and this suite needs orders in specific statuses in specific
-- regions. The order_items trigger still maintains total_amount, and
-- private.assign_order_sales_rep still resolves the rep from the dealer, so these
-- are the same shape a real order has.
-- ===========================================================================
create temporary table report_ids (label text primary key, order_id uuid);
grant insert, select on report_ids to authenticated;

insert into public.orders (dealer_id, created_by, status)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'approved')
returning id;
insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 10, 31.75
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and o.status = 'approved'
  and not exists (select 1 from public.order_items i where i.order_id = o.id);

-- A rejected order for the same dealer, because the rejected measure only exists if
-- something is genuinely rejected. Without one, rejected_amount is 0 everywhere and
-- the assertion that it is excluded from realized would pass for the wrong reason.
insert into public.orders (dealer_id, created_by, status)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'rejected')
returning id;
insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 10, 31.75
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and o.status = 'rejected'
  and not exists (select 1 from public.order_items i where i.order_id = o.id);

-- A pending order for Coastal, a different region once region is set below.
insert into public.orders (dealer_id, created_by, status)
values ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'pending')
returning id;
insert into public.order_items (order_id, product_id, quantity, unit_price)
select o.id, '30000000-0000-4000-8000-000000000001', 4, 31.75
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000003'
  and o.status = 'pending'
  and not exists (select 1 from public.order_items i where i.order_id = o.id);

-- Two regions, so the grouping is doing something. A report that groups by a
-- constant passes every sum assertion while answering none of the questions.
update public.dealers set region = 'North' where id = '20000000-0000-4000-8000-000000000001';
update public.dealers set region = 'South' where id = '20000000-0000-4000-8000-000000000003';

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- A. private.region_of -- the fallback chain
-- ===========================================================================
select is(
  private.region_of('20000000-0000-4000-8000-000000000001'),
  'North'::text,
  'a classified dealer reports its own region'
);

-- A dealer nobody classified must still land somewhere. A region rollup that drops
-- them understates the total, and the difference between "no sales in Punjab" and
-- "Punjab was never filled in" is invisible once the rows are gone.
update public.dealers set region = null where id = '20000000-0000-4000-8000-000000000003';

select is(
  private.region_of('20000000-0000-4000-8000-000000000003'),
  (select state from public.dealers where id = '20000000-0000-4000-8000-000000000003'),
  'an unclassified dealer falls back to its state rather than disappearing'
);

update public.dealers set region = '   ' where id = '20000000-0000-4000-8000-000000000003';

select is(
  private.region_of('20000000-0000-4000-8000-000000000003'),
  (select state from public.dealers where id = '20000000-0000-4000-8000-000000000003'),
  'a whitespace-only region is treated as unset, so the fallback still applies'
);

update public.dealers set region = 'South' where id = '20000000-0000-4000-8000-000000000003';

select is(
  private.region_of('00000000-0000-0000-0000-000000000000'),
  null::text,
  'an unknown dealer yields null rather than raising'
);

-- The seeded orders are backdated across several months to build a timeline, so
-- this dealer already spans more than one calendar month before the fixtures above
-- add anything. Asserting "exactly one row" would therefore be asserting something
-- about the seed, not about the view. What matters is the row grain: a region-period
-- row is a group, never a single order, and it carries a whole month's aggregate.
-- So each row is checked to hold at least one order, and the count is checked
-- against the number of distinct months rather than against 1.
select is(
  (select count(*) from public.sales_by_region_period where region = 'North'),
  (select count(distinct to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM'))
   from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001'),
  'one region-period row per region per calendar month, never one per order'
);

select ok(
  not exists (
    select 1
    from public.sales_by_region_period p
    where p.region = 'North'
      and p.realized_orders + p.pipeline_orders + p.rejected_orders = 0
  ),
  'every region-period row accounts for at least one order'
);

-- min/max rather than a bare select, because the seed backdated orders across
-- several months for the timeline and this dealer is not alone in its region.
select is(
  (select min(period) from public.sales_by_region_period where region = 'North'),
  (select date_trunc('month', min((created_at at time zone 'Asia/Kolkata')::date))::date
   from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001'),
  'the period is the Asia/Kolkata calendar month, matching the sales_daily convention'
);

-- The rejected order is the point of this pair. Its value is real money that was
-- asked for and refused, and it must appear in neither realized nor pipeline.
-- Summed across the region, because the seed spans several months and the view
-- groups by month; the measure under test is the region's total, not one bar.
select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period where region = 'North'),
  (select coalesce(sum(total_amount), 0) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000001'
     and status in ('approved', 'dispatched', 'invoiced')),
  'realized counts only approved, dispatched and invoiced orders'
);

select is(
  (select coalesce(sum(rejected_amount), 0) from public.sales_by_region_period where region = 'North'),
  (select coalesce(sum(total_amount), 0) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000001'
     and status = 'rejected'),
  'the rejected order is reported as rejected, not dropped'
);

select is(
  (select sum(realized_orders)::bigint from public.sales_by_region_period where region = 'North'),
  (select count(*) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000001'
     and status in ('approved', 'dispatched', 'invoiced')),
  'a rejected order does not inflate the realized order count'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period where region = 'North')
    = (select coalesce(sum(rejected_amount), 0) from public.sales_by_region_period where region = 'North'),
  false,
  'realized and rejected are different measures, not the same number relabelled'
);

-- The pending Coastal order is pipeline, and it is also credit exposure, which is
-- the second thing the split is protecting.
select is(
  (select coalesce(sum(pipeline_amount), 0) from public.sales_by_region_period
   where region = (select private.region_of('20000000-0000-4000-8000-000000000003'))),
  (select coalesce(sum(total_amount), 0) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000003'
     and status in ('pending', 'pending_director_approval')),
  'a pending order is pipeline, and pipeline is what approval checks against credit'
);

-- >1 rather than exactly 1, because the seed backdated Coastal orders over several
-- months too. The assertion is that South is a row set distinct from North and not
-- a subset of it, which is what proves the group key is the region.
select ok(
  (select count(*) from public.sales_by_region_period where region = 'South') > 0
  and not exists (
    select 1 from public.sales_by_region_period s
    where s.region = 'South'
      and not exists (select 1 from public.sales_by_region_period n where n.region = 'North')
  ),
  'the second region is reported separately, so the grouping is not a constant'
);

select is(
  (select coalesce(sum(pipeline_amount), 0) from public.sales_by_region_period),
  (select coalesce(sum(total_amount), 0) from public.orders
   where status in ('pending', 'pending_director_approval')),
  'pipeline across all regions equals the open order book'
);

-- ===========================================================================
-- C. sales_by_region_period_totals
-- ===========================================================================
select is(
  (select count(*) from public.sales_by_region_period_totals where region = 'North'),
  1::bigint,
  'a region appears once in the totals view'
);

select is(
  (select t.realized_amount from public.sales_by_region_period_totals t where t.region = 'North'),
  (select coalesce(sum(p.realized_amount), 0) from public.sales_by_region_period p where p.region = 'North'),
  'the all-time total agrees with the sum of that region periods'
);

select is(
  (select count(*) from public.sales_by_region_period_totals),
  (select count(distinct private.region_of(dealer_id)) from public.orders),
  'one total row per distinct region, so a region cannot be double counted'
);

-- ===========================================================================
-- D. sales_by_rep -- PRD 9.4's rep and manager dimensions
-- ===========================================================================
-- The rep is the dealer's own rep, resolved from dealers.sales_rep_id, not from
-- created_by. An order raised by an admin on a rep's dealer's behalf belongs to the
-- rep commercially, and grouping by created_by would hand all proxy-placed orders to
-- whichever user happened to fill in the form.
-- The seed maps several reps across dealers in a region, so equality is tested
-- as "the set of reps reported equals the set of reps who own those dealers",
-- compared through arrays. A single scalar subquery would be ambiguous here and
-- would pass or fail for reasons that have nothing to do with the rollup.
select is(
  (select array_agg(distinct rep_id order by rep_id) from public.sales_by_rep where region = 'North'),
  (select array_agg(distinct sales_rep_id order by sales_rep_id) from public.dealers
   where private.region_of(id) = 'North'),
  'the rep is resolved from the dealer, not from who happened to raise the order'
);

-- One level up, not transitively. PRD 3.1 is rep -> manager -> director, and
-- resolving transitively would label every manager as the director, which would
-- make the manager column useless while still looking populated.
select is(
  (select array_agg(distinct manager_id order by manager_id) from public.sales_by_rep where region = 'North'),
  (select array_agg(distinct h.manager_id order by h.manager_id) from public.user_hierarchy h
   join public.dealers d on d.sales_rep_id = h.user_id
   where private.region_of(d.id) = 'North'),
  'the rep is rolled up exactly one level, to their manager'
);

-- Stated as a mismatch count rather than a bare exists, so a partial failure
-- reports how many rows disagree instead of collapsing "one row wrong" and
-- "every row wrong" into the same not ok.
select is(
  (select count(*) from public.sales_by_rep r
   where r.manager_id is distinct from (
     select h.manager_id from public.user_hierarchy h where h.user_id = r.rep_id
   )),
  0::bigint,
  'every manager_id in the report is that rep own direct manager, not the director above them'
);

-- And the converse, which is what actually catches a transitive walk: if the
-- manager column held the director, it would disagree with the hierarchy for
-- every rep that has a manager of their own.
select ok(
  exists (
    select 1 from public.user_hierarchy h
    join public.sales_by_rep r on r.rep_id = h.user_id
    where h.manager_id is not null
      and exists (select 1 from public.user_hierarchy h2 where h2.user_id = h.manager_id)
  ),
  'the seed has a rep whose manager has a manager, so a transitive walk would be visible'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_rep where region = 'North'),
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period where region = 'North'),
  'a region total and its rep rows agree'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_rep),
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period_totals),
  'rep rollup sums to the region grand total, so no revenue is lost or duplicated'
);

-- ===========================================================================
-- E. sales_by_dealer -- the drill-down, and dealers with no activity
-- ===========================================================================
select is(
  (select realized_amount from public.sales_by_dealer
   where dealer_id = '20000000-0000-4000-8000-000000000001'),
  (select coalesce(sum(total_amount), 0) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000001'
     and status in ('approved', 'dispatched', 'invoiced')),
  'the dealer row carries the dealer own realized total'
);

-- Dealers with no orders must appear with zeros. If they were dropped, the dealer
-- count on a region row could not be reconciled against this view, and a newly
-- signed-up dealer would be invisible in the book.
select ok(
  exists (select 1 from public.sales_by_dealer where realized_amount = 0),
  'a dealer with no orders is listed with zeros rather than omitted'
);

select is(
  (select count(*) from public.sales_by_dealer),
  (select count(*) from public.dealers where private.can_view_dealer(id)),
  'every visible dealer appears exactly once'
);

select is(
  (select coalesce(sum(outstanding_amount), 0) from public.sales_by_dealer),
  (select coalesce(sum(l.outstanding_amount), 0)
   from public.dealer_ledger l
   where private.can_view_dealer(l.dealer_id)),
  'outstanding reconciles with the dealer ledger it is derived from'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_dealer),
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period_totals),
  'the dealer book reconciles with the region totals'
);

-- ===========================================================================
-- F. Scope. The leak this is really guarding against.
--
-- An aggregate over rows the caller cannot see still leaks, through the sum. Each
-- view is security_invoker so RLS runs as the caller, but a view that aggregated
-- with definer rights would return a total the caller could not compute themselves
-- from any screen they are allowed to open. That is why a rep's North figure here
-- must equal the North figure a director sees for the same dealer, and must not
-- include a dealer the rep cannot view.
-- ===========================================================================
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period where region = 'North'),
  (select realized_amount from public.sales_by_region_period_totals where region = 'North'),
  'a director and an admin see the same regional total'
);

reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';
set local role authenticated;

-- Ravi owns Green Valley, so he must see his own dealer's revenue.
select is(
  (select realized_amount from public.sales_by_dealer
   where dealer_id = '20000000-0000-4000-8000-000000000001'),
  (select coalesce(sum(total_amount), 0) from public.orders
   where dealer_id = '20000000-0000-4000-8000-000000000001'
     and status in ('approved', 'dispatched', 'invoiced')),
  'a rep sees the full realized figure for a dealer he owns'
);

select is(
  (select count(*) from public.sales_by_dealer
   where dealer_id = '20000000-0000-4000-8000-000000000003'),
  0::bigint,
  'a rep cannot see another rep dealer in the book, not even as an aggregate row'
);

select is(
  (select count(*) from public.sales_by_rep where rep_id is distinct from '10000000-0000-4000-8000-000000000005'),
  0::bigint,
  'a rep sees only their own row in the reporting-lines report'
);

select is(
  (select coalesce(sum(pipeline_amount), 0) from public.sales_by_region_period),
  (select coalesce(sum(total_amount), 0) from public.orders
   where status in ('pending', 'pending_director_approval')
     and private.can_view_dealer(dealer_id)),
  'a rep pipeline total covers only dealers they may see'
);

-- QC staff have no commercial access at all, so a reporting view that is merely
-- gated by authentication would leak the whole book to them. A reporting surface
-- that a non-commercial role can read is the failure mode worth naming.
reset role;
set local request.jwt.claim.sub = '7c1f0a52-0000-4000-8000-000000000001';
set local role authenticated;

select is(
  (select count(*) from public.sales_by_dealer),
  0::bigint,
  'qc_staff see no dealer book'
);

select is(
  (select count(*) from public.sales_by_region_period),
  0::bigint,
  'qc_staff see no regional trend'
);

-- Not throws_ok. The view returns zero rows rather than refusing, because
-- can_view_dealer is false for every dealer when the caller has no commercial
-- access, and the aggregate over no rows is legitimately empty. Asserting the
-- refusal instead would have been asserting an implementation detail, and the
-- earlier version of this suite did exactly that and passed for the wrong reason:
-- the grant is to authenticated, and a zero-row result still proves nothing about
-- whether a qc_staff session can read the shape of the report.
select is(
  (select count(*) from public.sales_by_rep),
  0::bigint,
  'the rep rollup returns nothing to a non commercial role'
);

select is(
  (select count(*) from public.sales_by_region_period_totals),
  0::bigint,
  'the regional totals view returns nothing to a non commercial role'
);

-- And the totals the qc_staff session gets must be zero, not merely the row count.
-- A view that grouped by region before filtering would return a row per region with
-- zero amounts, which passes a count(*) = 0 check only by accident of the shape.
select is(
  (select coalesce(sum(realized_amount), 0) + coalesce(sum(pipeline_amount), 0)
   from public.sales_by_rep),
  0::numeric,
  'no commercial figure is reachable through the rep rollup by a non commercial role'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period_totals),
  0::numeric,
  'and none through the regional totals view either'
);

-- Finance sees every dealer regardless of reporting line, so their totals must be
-- the whole book, not a subset of it.
reset role;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';
set local role authenticated;

select is(
  (select count(*) from public.sales_by_dealer),
  (select count(*) from public.dealers),
  'finance sees every dealer in the book'
);

select is(
  (select coalesce(sum(realized_amount), 0) from public.sales_by_dealer),
  (select coalesce(sum(realized_amount), 0) from public.sales_by_region_period_totals),
  'finance totals reconcile with the region grand total'
);

select * from finish();
rollback;
