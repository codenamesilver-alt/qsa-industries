create or replace view public.sales_daily
with (security_invoker = true)
as
select
  (o.created_at at time zone 'Asia/Kolkata')::date as order_date,
  count(*)::bigint as order_count,
  coalesce(sum(o.total_amount) filter (where o.status in ('approved', 'dispatched', 'invoiced')), 0) as approved_sales_amount,
  coalesce(sum(o.total_amount) filter (where o.status = 'rejected'), 0) as rejected_amount
from public.orders as o
group by (o.created_at at time zone 'Asia/Kolkata')::date;

create or replace view public.sales_status_summary
with (security_invoker = true)
as
select
  o.status,
  count(*)::bigint as order_count,
  coalesce(sum(o.total_amount), 0) as total_amount
from public.orders as o
group by o.status;

create or replace view public.top_dealers
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  count(o.id)::bigint as order_count,
  coalesce(sum(o.total_amount) filter (where o.status in ('approved', 'dispatched', 'invoiced')), 0) as sales_amount,
  coalesce(sum(o.total_amount) filter (where o.status in ('pending', 'pending_director_approval', 'approved')), 0) as credit_exposure
from public.dealers as d
left join public.orders as o on o.dealer_id = d.id
group by d.id, d.name;

create or replace view public.dealer_credit_exposure
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  coalesce(d.credit_limit_override, d.credit_limit, 0) as credit_limit,
  coalesce(credit.exposure, 0) as exposure,
  coalesce(credit.available_credit, coalesce(d.credit_limit_override, d.credit_limit, 0)) as available_credit
from public.dealers as d
left join lateral (
  select
    cs.exposure,
    cs.available_credit
  from public.credit_summary(d.id) as cs
) as credit on true;

create or replace view public.order_status_board
with (security_invoker = true)
as
select
  o.status,
  count(*)::bigint as order_count,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.created_at) as oldest_created_at
from public.orders as o
group by o.status;

create or replace view public.inventory_dashboard
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.category,
  p.unit_of_measure,
  s.current_quantity,
  p.low_stock_threshold,
  s.current_quantity <= p.low_stock_threshold as low_stock,
  s.updated_at
from public.products as p
join public.stock_levels as s on s.product_id = p.id
where p.active;

create or replace view public.production_period_summary
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
  date_trunc('day', r.run_date)::date as run_date,
  p.id as product_id,
  p.name as product_name,
  sum(r.quantity_produced) as total_output,
  coalesce(sum(mt.raw_material_quantity), 0) as total_raw_material_input,
  case
    when coalesce(sum(mt.raw_material_quantity), 0) > 0
      then round(sum(r.quantity_produced) / sum(mt.raw_material_quantity), 4)
    else null
  end as yield_ratio
from public.production_runs as r
join public.products as p on p.id = r.product_id
left join material_totals as mt on mt.run_id = r.id
where r.qc_status = 'passed'
group by date_trunc('day', r.run_date)::date, p.id, p.name;

create or replace view public.dealer_catalog
with (security_invoker = true)
as
select
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.category,
  p.unit_of_measure,
  p.price as list_price,
  coalesce(pl.price, p.price) as unit_price,
  coalesce(s.current_quantity, 0) as available_quantity,
  p.low_stock_threshold
from public.products as p
left join public.stock_levels as s on s.product_id = p.id
left join lateral (
  select price
  from public.price_lists
  where product_id = p.id
    and (
      dealer_id = (select private.current_dealer_id())
      or (dealer_id is null and price_tier = 'standard_dealer')
    )
    and (valid_from is null or valid_from <= private.business_date())
    and (valid_to is null or valid_to >= private.business_date())
  order by dealer_id is not null desc, valid_from desc nulls last, id desc
  limit 1
) as pl on true
where p.active
  and p.is_sellable;

grant select on table public.sales_daily to authenticated;
grant select on table public.sales_status_summary to authenticated;
grant select on table public.top_dealers to authenticated;
grant select on table public.dealer_credit_exposure to authenticated;
grant select on table public.order_status_board to authenticated;
grant select on table public.inventory_dashboard to authenticated;
grant select on table public.production_period_summary to authenticated;
grant select on table public.dealer_catalog to authenticated;
