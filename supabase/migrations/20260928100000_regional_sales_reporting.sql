-- Regional and period sales reporting, the PRD 9.4 line that was never actually met.
--
-- 20260926093400_dealer_region.sql added dealers.region and a public.sales_by_region
-- view, which looks like this requirement being done. It is not, for three reasons:
--
--   1. That view has no time axis. Every figure is "all of history since the epoch",
--      so it cannot answer a trend question, and PRD 9.4 asks for "region/period".
--   2. It sums orders of every status together, so a rejected order and a delivered
--      one land in the same "order_value" column. That number is not revenue and is
--      not credit exposure either. It is a total, and a meaningless one.
--   3. It has no rep or manager dimension, which PRD 9.4 also asks for
--      ("by dealer, rep, manager, region/period").
--
-- So this replaces it with four views that keep revenue and pipeline separate, and
-- add a period axis plus the hierarchy rollup that was missing.
--
-- Reporting definitions used throughout, stated once so the numbers are checkable:
--
--   realized      orders in (approved, dispatched, invoiced) -- revenue the business
--                 has committed to and not walked back.
--   pipeline      orders in (pending, pending_director_approval) -- demand that is
--                 live but not yet committed, i.e. credit exposure.
--   rejected      orders rejected -- reported so approval quality is visible, never
--                 folded into either of the above.
--
-- Periods are calendar months in Asia/Kolkata, matching sales_daily, which already
-- fixed that timezone convention for reporting. Grouping on date_trunc of a timestamptz
-- in UTC would silently split the 1st of each month for anything booked after 5:30am,
-- which is most of a working day here.
--
-- All four views are security_invoker, so the existing RLS on orders, dealers and users
-- applies as the calling user rather than as the view owner. Visibility still goes
-- through private.can_view_dealer so a rep sees only their own accounts and a manager
-- sees their reports'. This is a reporting change only: no table is altered, no grant
-- is widened, and no existing view is dropped, so a regression here cannot break a
-- screen that already works.

-- ---------------------------------------------------------------------------
-- region_of(dealer_id) -- the one place a dealer's reporting region is decided.
--
-- region -> state -> 'Unassigned' fallback, matching the view being replaced. The
-- fallback is deliberate: a dealer nobody has classified must still appear in the
-- report, because a region rollup that silently drops dealers understates the total
-- and nobody notices the difference between "no sales in Punjab" and "Punjab was
-- never filled in".
-- ---------------------------------------------------------------------------
create or replace function private.region_of(target_dealer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(d.region, ''), nullif(d.state, ''), 'Unassigned')
  from public.dealers as d
  where d.id = target_dealer_id
$$;

-- ---------------------------------------------------------------------------
-- public.sales_by_region_period -- the primary regional trend view.
--
-- One row per region per calendar month, plus realized/pipeline split. This is the
-- view a sales manager asks for: "how is each region trending".
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_region_period
with (security_invoker = true)
as
with visible as (
  select
    o.id,
    o.status,
    o.total_amount,
    (o.created_at at time zone 'Asia/Kolkata')::date as order_date,
    private.region_of(o.dealer_id) as region,
    o.dealer_id
  from public.orders as o
  where private.can_view_dealer(o.dealer_id)
)
select
  v.region,
  date_trunc('month', v.order_date)::date as period,
  count(distinct v.dealer_id) filter (
    where v.status in ('approved', 'dispatched', 'invoiced')
  ) as dealers_selling,
  count(*) filter (
    where v.status in ('approved', 'dispatched', 'invoiced')
  ) as realized_orders,
  coalesce(
    sum(v.total_amount) filter (
      where v.status in ('approved', 'dispatched', 'invoiced')
    ),
    0
  ) as realized_amount,
  count(*) filter (
    where v.status in ('pending', 'pending_director_approval')
  ) as pipeline_orders,
  coalesce(
    sum(v.total_amount) filter (
      where v.status in ('pending', 'pending_director_approval')
    ),
    0
  ) as pipeline_amount,
  count(*) filter (where v.status = 'rejected') as rejected_orders,
  coalesce(
    sum(v.total_amount) filter (where v.status = 'rejected'),
    0
  ) as rejected_amount
from visible as v
group by v.region, date_trunc('month', v.order_date)::date;

grant select on public.sales_by_region_period to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_by_region_period_totals -- regional totals, all time.
--
-- Kept separate from the trend view rather than as a windowed total column, so the
-- "compare this region against everything" question does not need the client to
-- aggregate a month-bucketed set. A region with no orders at all is absent, which
-- is correct here and is exactly why the per-period view above cannot serve this.
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_region_period_totals
with (security_invoker = true)
as
select
  private.region_of(o.dealer_id) as region,
  count(distinct o.dealer_id) as dealer_count,
  count(*) filter (
    where o.status in ('approved', 'dispatched', 'invoiced')
  ) as realized_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ),
    0
  ) as realized_amount,
  count(*) filter (
    where o.status in ('pending', 'pending_director_approval')
  ) as pipeline_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('pending', 'pending_director_approval')
    ),
    0
  ) as pipeline_amount
from public.orders as o
where private.can_view_dealer(o.dealer_id)
group by private.region_of(o.dealer_id);

grant select on public.sales_by_region_period_totals to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_by_rep -- PRD 9.4's "by dealer, rep, manager".
--
-- Rolls each rep up to their manager so a manager can rank their team without the
-- client having to know the hierarchy shape. The manager is resolved one level up
-- from user_hierarchy rather than transitively: PRD 3.1 is a three level tree
-- (rep -> manager -> director), and a director is a manager's peer for this purpose.
-- Resolving transitively would relabel every manager as the director and make the
-- manager column useless.
--
-- A rep with no hierarchy row is reported under 'Unassigned' rather than dropped.
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_rep
with (security_invoker = true)
as
select
  o.sales_rep_id as rep_id,
  coalesce(nullif(rep.full_name, ''), 'Unassigned rep') as rep_name,
  mgr.id as manager_id,
  coalesce(nullif(mgr.full_name, ''), 'Unassigned manager') as manager_name,
  private.region_of(o.dealer_id) as region,
  count(distinct o.dealer_id) as dealer_count,
  count(*) filter (
    where o.status in ('approved', 'dispatched', 'invoiced')
  ) as realized_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ),
    0
  ) as realized_amount,
  count(*) filter (
    where o.status in ('pending', 'pending_director_approval')
  ) as pipeline_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('pending', 'pending_director_approval')
    ),
    0
  ) as pipeline_amount
from public.orders as o
left join public.users as rep on rep.id = o.sales_rep_id
left join public.user_hierarchy as h on h.user_id = o.sales_rep_id
left join public.users as mgr on mgr.id = h.manager_id
where private.can_view_dealer(o.dealer_id)
group by
  o.sales_rep_id,
  coalesce(nullif(rep.full_name, ''), 'Unassigned rep'),
  mgr.id,
  coalesce(nullif(mgr.full_name, ''), 'Unassigned manager'),
  private.region_of(o.dealer_id);

grant select on public.sales_by_rep to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_by_dealer -- PRD 9.4's "by dealer", and the drill-down under region.
--
-- Includes dealers with no orders, with zeros, so the dealer count on a region row
-- can be reconciled against this view instead of two different numbers.
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_dealer
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  private.region_of(d.id) as region,
  d.state,
  d.status,
  d.credit_limit,
  coalesce(o.realized_orders, 0) as realized_orders,
  coalesce(o.realized_amount, 0) as realized_amount,
  coalesce(o.pipeline_orders, 0) as pipeline_orders,
  coalesce(o.pipeline_amount, 0) as pipeline_amount,
  coalesce(o.invoiced_amount, 0) as invoiced_amount,
  coalesce(inv.open_invoices, 0) as open_invoices,
  coalesce(inv.outstanding_amount, 0) as outstanding_amount
from public.dealers as d
left join (
  select
    o.dealer_id,
    count(*) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ) as realized_orders,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ),
      0
    ) as realized_amount,
    count(*) filter (
      where o.status in ('pending', 'pending_director_approval')
    ) as pipeline_orders,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('pending', 'pending_director_approval')
      ),
      0
    ) as pipeline_amount,
    coalesce(
      sum(o.total_amount) filter (where o.status = 'invoiced'),
      0
    ) as invoiced_amount
  from public.orders as o
  where private.can_view_dealer(o.dealer_id)
  group by o.dealer_id
) as o on o.dealer_id = d.id
left join lateral (
  select
    count(*) filter (where l.outstanding_amount > 0) as open_invoices,
    coalesce(sum(l.outstanding_amount), 0) as outstanding_amount
  from public.dealer_ledger as l
  where l.dealer_id = d.id
) as inv on true
where private.can_view_dealer(d.id);

grant select on public.sales_by_dealer to authenticated;
