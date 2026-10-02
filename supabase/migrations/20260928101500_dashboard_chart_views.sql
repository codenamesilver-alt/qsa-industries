-- Dashboard chart sources, so /internal and /sales can show pictures without
-- inventing a reporting definition per screen.
--
-- The existing dashboard views cannot be charted as they stand:
--
--   public.sales_daily          realized and rejected only. No pipeline column, so a
--                               bar built from it would show approved against
--                               rejected and say nothing about live demand, which is
--                               the number a manager is judged on.
--   public.sales_status_summary sums every status into one total_amount, so an order
--                               worth nothing because it was rejected and one worth
--                               everything because it shipped are drawn at the same
--                               weight.
--   public.production_period_summary is per run and per product, not per day, so a
--                               trend line drawn from it double counts a day with three
--                               runs and has no yield series to plot.
--   public.inventory_dashboard  current quantity against threshold, which is a
--                               position and not a movement. Nothing ages.
--
-- So three new views, each answering one chart, plus an ageing view for inventory
-- because PRD 9.4 asks for it by name.
--
-- Definitions match 20260928100000 exactly, on purpose. Realized is approved,
-- dispatched, invoiced. Pipeline is pending and pending_director_approval. Rejected
-- is reported and never folded in. Two different definitions of realized on two
-- different screens is how a finance team ends up arguing about a number that is
-- correct on both.
--
-- All views are security_invoker, so the RLS underneath applies as the calling user.
-- A chart that aggregates rows the caller cannot see leaks through the aggregate even
-- when every underlying row is protected, and a chart is exactly where that is least
-- likely to be noticed: it shows a shape, not a row.

-- ---------------------------------------------------------------------------
-- public.sales_daily_split -- the /sales dashboard trend.
--
-- Calendar days in Asia/Kolkata, matching sales_daily and every other reporting
-- view here. Days with no orders are absent, not zero, and the chart backfills them:
-- a day-bucketed view that emitted a zero row would let a chart library plot a real
-- dip where there was simply no trading, and there is no way to tell those apart
-- from the shape alone.
--
-- Scoped by can_view_dealer rather than relying on orders_select_scope, because
-- that policy admits admin, logistics and finance directly and a rep through
-- can_view_dealer. Going through the same function the other reporting views use
-- keeps one definition of "whose orders are these".
-- ---------------------------------------------------------------------------
create or replace view public.sales_daily_split
with (security_invoker = true)
as
select
  (o.created_at at time zone 'Asia/Kolkata')::date as order_date,
  count(*) filter (
    where o.status in ('approved', 'dispatched', 'invoiced')
  )::bigint as realized_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ),
    0
  ) as realized_amount,
  count(*) filter (
    where o.status in ('pending', 'pending_director_approval')
  )::bigint as pipeline_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('pending', 'pending_director_approval')
    ),
    0
  ) as pipeline_amount,
  count(*) filter (where o.status = 'rejected')::bigint as rejected_orders,
  coalesce(
    sum(o.total_amount) filter (where o.status = 'rejected'),
    0
  ) as rejected_amount
from public.orders as o
where private.can_view_dealer(o.dealer_id)
group by (o.created_at at time zone 'Asia/Kolkata')::date;

grant select on public.sales_daily_split to authenticated;

-- ---------------------------------------------------------------------------
-- public.order_stage_funnel -- where orders are sitting.
--
-- One row per status with the value at that status, ordered along the lifecycle
-- rather than alphabetically, because a funnel read in the wrong order tells you
-- nothing. The stage_order column is the lifecycle position; sorting by status
-- would put rejected between pending and approved, which is not a path any order
-- takes.
--
-- A status with no orders is absent. For this one that is correct rather than
-- inconvenient: the question is where orders are stuck, and a stage nobody has
-- reached is not a stage anything is stuck in.
-- ---------------------------------------------------------------------------
create or replace view public.order_stage_funnel
with (security_invoker = true)
as
select
  o.status,
  -- The six statuses order_status actually has. There is no in_transit and no
  -- delivered: shipping stops at dispatched and invoicing is the last leg, so a
  -- lifecycle position for them would be a stage no order can occupy, and the
  -- funnel would show a gap that is an artefact of the enum rather than of trading.
  case o.status
    when 'pending' then 1
    when 'pending_director_approval' then 2
    when 'approved' then 3
    when 'dispatched' then 4
    when 'invoiced' then 5
    when 'rejected' then 6
    else 7
  end as stage_order,
  count(*)::bigint as order_count,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.created_at) as oldest_created_at
from public.orders as o
where private.can_view_dealer(o.dealer_id)
group by o.status;

grant select on public.order_stage_funnel to authenticated;

-- ---------------------------------------------------------------------------
-- public.production_daily_output -- the /internal dashboard production chart.
--
-- Per day, summed across products, because a per-run-per-product row cannot be
-- plotted on a time axis without the client guessing which rows are the same day.
--
-- yield_ratio is output over raw material input, the same arithmetic
-- production_period_summary already uses. It is null when a day consumed no recorded
-- material rather than 0, because "made goods from unrecorded inputs" and "made
-- nothing" are different facts and a chart should be able to show the gap.
-- ---------------------------------------------------------------------------
create or replace view public.production_daily_output
with (security_invoker = true)
as
with material_totals as (
  select
    m.run_id,
    sum(m.quantity_consumed) as raw_material_quantity
  from public.production_run_materials as m
  group by m.run_id
)
select
  r.run_date,
  count(*)::bigint as run_count,
  count(distinct r.product_id)::bigint as product_count,
  sum(r.quantity_produced) as total_output,
  coalesce(sum(mt.raw_material_quantity), 0) as total_input,
  case
    when coalesce(sum(mt.raw_material_quantity), 0) > 0
      then round(sum(r.quantity_produced) / sum(mt.raw_material_quantity), 4)
    else null
  end as yield_ratio
from public.production_runs as r
left join material_totals as mt on mt.run_id = r.id
where r.qc_status = 'passed'
group by r.run_date;

grant select on public.production_daily_output to authenticated;

-- ---------------------------------------------------------------------------
-- public.production_yield_by_product -- the same measure, per product.
--
-- A daily total hides which product is dragging the ratio down, which is the only
-- reason anyone looks at yield. Separate because summing a ratio across products is
-- meaningless: 100 units from a product with a 1.0 yield and 100 from a 0.2 yield is
-- not a 0.6 anything.
-- ---------------------------------------------------------------------------
create or replace view public.production_yield_by_product
with (security_invoker = true)
as
with material_totals as (
  select
    m.run_id,
    sum(m.quantity_consumed) as raw_material_quantity
  from public.production_run_materials as m
  group by m.run_id
)
select
  p.id as product_id,
  p.name as product_name,
  p.sku,
  count(*)::bigint as run_count,
  sum(r.quantity_produced) as total_output,
  coalesce(sum(mt.raw_material_quantity), 0) as total_input,
  case
    when coalesce(sum(mt.raw_material_quantity), 0) > 0
      then round(sum(r.quantity_produced) / sum(mt.raw_material_quantity), 4)
    else null
  end as yield_ratio,
  max(r.run_date) as last_run_date
from public.production_runs as r
join public.products as p on p.id = r.product_id
left join material_totals as mt on mt.run_id = r.id
where r.qc_status = 'passed'
group by p.id, p.name, p.sku;

grant select on public.production_yield_by_product to authenticated;

-- ---------------------------------------------------------------------------
-- public.inventory_aging -- PRD 9.4's "inventory aging and stock levels".
--
-- Ageing here is the age of the last movement on the product, not the age of the
-- stock, because the ledger has no lot or layer history to age against: movements
-- record a product, not a batch of stock. A batch table exists for expiry, but it
-- does not carry the receipt date of every unit ever received, so a true stock age
-- would be a guess.
--
-- So this is a movement-recency view and is named for that. Calling it an inventory
-- age would be the kind of label that gets a stock write-off decision made on it.
--
-- dead_stock is a boolean rather than a day count so the caller picks the threshold.
-- Sixty days is the usual grocery convention, but it is a business decision and this
-- database should not make it silently.
-- ---------------------------------------------------------------------------
create or replace view public.inventory_aging
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.category,
  p.unit_of_measure,
  coalesce(s.current_quantity, 0) as current_quantity,
  p.low_stock_threshold,
  s.updated_at as last_movement_at,
  (s.updated_at at time zone 'Asia/Kolkata')::date as last_movement_date,
  (private.business_date() - (s.updated_at at time zone 'Asia/Kolkata')::date) as days_since_movement,
  (s.updated_at is not null
    and (private.business_date() - (s.updated_at at time zone 'Asia/Kolkata')::date) >= 60
    and coalesce(s.current_quantity, 0) > 0) as dead_stock
from public.products as p
left join public.stock_levels as s on s.product_id = p.id
where p.active;

grant select on public.inventory_aging to authenticated;

-- ---------------------------------------------------------------------------
-- public.credit_exposure_summary -- credit by dealer, for the sales dashboard.
--
-- dealer_credit_exposure already exists and already reads through
-- private.credit_summary. It is left alone: it is correct, it is used by the sales
-- dashboard today, and it is not scoped by can_view_dealer, which is a separate
-- question and not one this migration is opening. What is added is the
-- dealer_ledger side, so the same view can show outstanding against exposure without
-- a second round trip, and so the outstanding figure cannot come from a different
-- definition than the one on the reporting screen.
-- ---------------------------------------------------------------------------
create or replace view public.credit_exposure_summary
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  private.region_of(d.id) as region,
  d.status,
  coalesce(d.credit_limit_override, d.credit_limit, 0) as credit_limit,
  coalesce(cs.exposure, 0) as exposure,
  coalesce(cs.available_credit, coalesce(d.credit_limit_override, d.credit_limit, 0)) as available_credit,
  coalesce(l.outstanding_amount, 0) as outstanding_amount,
  coalesce(l.open_invoices, 0) as open_invoices
from public.dealers as d
left join lateral (
  select
    p.exposure,
    p.available_credit
  from public.credit_summary(d.id) as p
) as cs on true
left join lateral (
  select
    count(*) filter (where e.outstanding_amount > 0) as open_invoices,
    coalesce(sum(e.outstanding_amount), 0) as outstanding_amount
  from public.dealer_ledger as e
  where e.dealer_id = d.id
) as l on true
where private.can_view_dealer(d.id);

grant select on public.credit_exposure_summary to authenticated;
