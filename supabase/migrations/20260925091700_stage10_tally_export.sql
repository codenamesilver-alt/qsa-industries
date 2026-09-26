create table public.tally_exports (
  id uuid primary key default gen_random_uuid(),
  format text not null check (format in ('csv', 'xml')),
  period_start date not null,
  period_end date not null,
  row_count integer not null check (row_count >= 0),
  storage_path text,
  checksum text,
  generated_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint tally_export_period_valid check (period_end >= period_start)
);

create index tally_exports_created_idx on public.tally_exports (created_at desc);

create or replace view public.tally_invoice_lines
with (security_invoker = true)
as
with invoice_lines as (
  select
    i.invoice_number,
    i.invoice_date,
    d.name as dealer_name,
    d.email as dealer_email,
    p.sku,
    p.name as product_name,
    oi.id as line_id,
    row_number() over (partition by i.id order by oi.id) as line_number,
    oi.quantity,
    oi.unit_price,
    oi.line_total,
    i.taxable_amount,
    i.gst_amount,
    i.total_amount
  from public.invoices as i
  join public.dealers as d on d.id = i.dealer_id
  join public.order_items as oi on oi.order_id = i.order_id
  join public.products as p on p.id = oi.product_id
)
select
  invoice_number,
  invoice_date,
  dealer_name,
  dealer_email,
  sku,
  product_name,
  line_id,
  quantity,
  unit_price,
  line_total,
  case when line_number = 1 then taxable_amount end as taxable_amount,
  case when line_number = 1 then gst_amount end as gst_amount,
  case when line_number = 1 then total_amount end as total_amount
from invoice_lines
where private.current_user_role() in ('admin', 'finance');

create or replace view public.tally_payment_lines
with (security_invoker = true)
as
with payment_balances as (
  select
    p.id as payment_id,
    p.dealer_id,
    p.invoice_id,
    p.payment_date,
    p.amount,
    p.mode,
    p.reference,
    coalesce(sum(pa.amount), 0) as allocated_amount
  from public.payments as p
  left join public.payment_allocations as pa on pa.payment_id = p.id
  group by p.id, p.dealer_id, p.invoice_id, p.payment_date, p.amount, p.mode, p.reference
), allocation_lines as (
  select
    'allocation:' || pa.id::text as line_id,
    pb.payment_id,
    (pa.created_at at time zone 'Asia/Kolkata')::date as export_date,
    pb.payment_date,
    d.name as dealer_name,
    pa.amount,
    pb.mode,
    pb.reference,
    i.invoice_number
  from payment_balances as pb
  join public.payment_allocations as pa on pa.payment_id = pb.payment_id
  join public.dealers as d on d.id = pb.dealer_id
  join public.invoices as i on i.id = pa.invoice_id
), remainder_lines as (
  select
    'payment:' || pb.payment_id::text as line_id,
    pb.payment_id,
    pb.payment_date as export_date,
    pb.payment_date,
    d.name as dealer_name,
    pb.amount - pb.allocated_amount as amount,
    pb.mode,
    pb.reference,
    direct_i.invoice_number
  from payment_balances as pb
  join public.dealers as d on d.id = pb.dealer_id
  left join public.invoices as direct_i on direct_i.id = pb.invoice_id
  where pb.amount > pb.allocated_amount
)
select lines.*
from (
  select * from allocation_lines
  union all
  select * from remainder_lines
) as lines
where private.current_user_role() in ('admin', 'finance');

create or replace function public.record_tally_export(
  export_format text,
  period_start_value date,
  period_end_value date,
  export_row_count integer,
  export_storage_path text default null,
  export_checksum text default null
)
returns public.tally_exports
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_row public.tally_exports%rowtype;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can record Tally exports';
  end if;

  if export_format is null or export_format not in ('csv', 'xml') then
    raise exception 'Export format must be csv or xml';
  end if;

  if period_start_value is null or period_end_value is null or export_row_count is null or export_row_count < 0 then
    raise exception 'Export period and row count are required';
  end if;

  if period_end_value < period_start_value then
    raise exception 'Export period is invalid';
  end if;

  insert into public.tally_exports (
    format,
    period_start,
    period_end,
    row_count,
    storage_path,
    checksum,
    generated_by
  )
  values (
    export_format,
    period_start_value,
    period_end_value,
    export_row_count,
    nullif(trim(export_storage_path), ''),
    nullif(trim(export_checksum), ''),
    (select auth.uid())
  )
  returning * into export_row;

  return export_row;
end;
$$;

alter table public.tally_exports enable row level security;
revoke all on table public.tally_exports from anon, authenticated;
grant select on table public.tally_exports to authenticated;
grant select on public.tally_invoice_lines, public.tally_payment_lines to authenticated;

drop policy if exists tally_exports_select_internal on public.tally_exports;
create policy tally_exports_select_internal
on public.tally_exports
for select
to authenticated
using (private.current_user_role() in ('admin', 'finance'));

revoke all on function public.record_tally_export(text, date, date, integer, text, text) from public;
grant execute on function public.record_tally_export(text, date, date, integer, text, text) to authenticated;

create or replace function public.create_stock_adjustment(
  target_product_id uuid,
  adjustment_quantity numeric,
  adjustment_movement_type public.stock_movement_type,
  adjustment_reason text
)
returns public.stock_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement_row public.stock_movements%rowtype;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'production_manager', 'inventory_manager') then
    raise exception 'You cannot adjust inventory';
  end if;

  if adjustment_quantity is null or adjustment_quantity <= 0 or adjustment_quantity = 'NaN'::numeric then
    raise exception 'Adjustment quantity must be positive';
  end if;

  adjustment_quantity := round(adjustment_quantity, 2);

  if adjustment_quantity <= 0 then
    raise exception 'Adjustment quantity must be positive';
  end if;

  if adjustment_movement_type is null or adjustment_movement_type not in ('in', 'out') then
    raise exception 'Adjustment movement type must be in or out';
  end if;

  if nullif(trim(adjustment_reason), '') is null then
    raise exception 'An adjustment reason is required';
  end if;

  insert into public.stock_movements (
    product_id,
    quantity,
    movement_type,
    source,
    reason,
    created_by
  )
  values (
    target_product_id,
    adjustment_quantity,
    adjustment_movement_type,
    'adjustment',
    trim(adjustment_reason),
    (select auth.uid())
  )
  returning * into movement_row;

  return movement_row;
end;
$$;

create or replace function public.create_production_run(
  target_product_id uuid,
  output_quantity numeric,
  run_shift text,
  run_date_value date default private.business_date(),
  material_rows jsonb default '[]'::jsonb,
  qc_status_value public.production_qc_status default 'pending',
  qc_notes_value text default null
)
returns public.production_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.production_runs%rowtype;
  material_row record;
  material_unit text;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'production_manager') then
    raise exception 'You cannot create production runs';
  end if;

  if output_quantity is null or output_quantity <= 0 or output_quantity = 'NaN'::numeric then
    raise exception 'Output quantity must be positive';
  end if;

  output_quantity := round(output_quantity, 2);

  if output_quantity <= 0 then
    raise exception 'Output quantity must be positive';
  end if;

  if not exists (
    select 1
    from public.products
    where id = target_product_id
      and active
      and is_sellable
  ) then
    raise exception 'Finished product % is not active and sellable', target_product_id;
  end if;

  if material_rows is null or jsonb_typeof(material_rows) <> 'array' then
    raise exception 'Material rows must be a JSON array';
  end if;

  if jsonb_array_length(material_rows) = 0 then
    raise exception 'At least one material row is required';
  end if;

  if qc_status_value is null then
    raise exception 'QC status is required';
  end if;

  if qc_status_value = 'failed' and nullif(trim(qc_notes_value), '') is null then
    raise exception 'Failed QC requires notes';
  end if;

  insert into public.production_runs (
    run_date,
    shift,
    product_id,
    quantity_produced,
    qc_status,
    qc_notes,
    created_by
  )
  values (
    coalesce(run_date_value, private.business_date()),
    run_shift,
    target_product_id,
    output_quantity,
    qc_status_value,
    nullif(trim(qc_notes_value), ''),
    (select auth.uid())
  )
  returning * into run_row;

  if exists (
    select 1
    from jsonb_to_recordset(material_rows)
      as requested(product_id uuid, quantity numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity = 'NaN'::numeric
  ) then
    raise exception 'Each material row needs a raw material and positive quantity';
  end if;

  for material_row in
    select product_id, sum(quantity)::numeric(14, 2) as quantity
    from jsonb_to_recordset(material_rows)
      as requested(product_id uuid, quantity numeric)
    group by product_id
    order by product_id
  loop
    if material_row.product_id is null or material_row.quantity is null or material_row.quantity <= 0 or material_row.quantity = 'NaN'::numeric then
      raise exception 'Each material row needs a raw material and positive quantity';
    end if;

    select unit
    into material_unit
    from public.raw_materials
    where product_id = material_row.product_id;

    if material_unit is null then
      raise exception 'Raw material product % is not configured', material_row.product_id;
    end if;

    insert into public.production_run_materials (
      run_id,
      raw_material_id,
      quantity_consumed,
      unit
    )
    select
      run_row.id,
      rm.id,
      material_row.quantity,
      material_unit
    from public.raw_materials as rm
    where rm.product_id = material_row.product_id;
  end loop;

  return run_row;
end;
$$;

create or replace function public.create_dealer_order(order_lines jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  line_row record;
  dealer_id_value uuid;
  list_price numeric(14, 2);
  available_quantity numeric(14, 2);
  unit_price numeric(14, 2);
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();
  dealer_id_value := (select private.current_dealer_id());

  if actor_role is null or actor_role <> 'dealer' or dealer_id_value is null then
    raise exception 'Only a dealer account can place orders';
  end if;

  if not exists (
    select 1
    from public.dealers
    where id = dealer_id_value
      and status = 'active'
  ) then
    raise exception 'Dealer account is not active';
  end if;

  if order_lines is null or jsonb_typeof(order_lines) <> 'array' then
    raise exception 'Order lines must be a JSON array';
  end if;

  if jsonb_array_length(order_lines) = 0 then
    raise exception 'At least one order line is required';
  end if;

  insert into public.orders (dealer_id, created_by)
  values (dealer_id_value, (select auth.uid()))
  returning * into order_row;

  if exists (
    select 1
    from jsonb_to_recordset(order_lines)
      as requested(product_id uuid, quantity numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity = 'NaN'::numeric
  ) then
    raise exception 'Each order line needs a product and positive quantity';
  end if;

  for line_row in
    select product_id, sum(quantity)::numeric(14, 2) as quantity
    from jsonb_to_recordset(order_lines)
      as requested(product_id uuid, quantity numeric)
    group by product_id
    order by product_id
  loop
    if line_row.product_id is null or line_row.quantity is null or line_row.quantity <= 0 or line_row.quantity = 'NaN'::numeric then
      raise exception 'Each order line needs a product and positive quantity';
    end if;

    select
      p.price,
      coalesce(s.current_quantity, 0),
      coalesce(pl.price, p.price)
    into
      list_price,
      available_quantity,
      unit_price
    from public.products as p
    left join public.stock_levels as s on s.product_id = p.id
    left join lateral (
      select price
      from public.price_lists
      where product_id = p.id
        and (
          dealer_id = dealer_id_value
          or (dealer_id is null and price_tier = 'standard_dealer')
        )
        and (valid_from is null or valid_from <= private.business_date())
        and (valid_to is null or valid_to >= private.business_date())
      order by dealer_id is not null desc, valid_from desc nulls last, id desc
      limit 1
    ) as pl on true
    where p.id = line_row.product_id
      and p.active
      and p.is_sellable;

    if not found then
      raise exception 'Product % is not available for ordering', line_row.product_id;
    end if;

    if available_quantity < line_row.quantity then
      raise exception 'Insufficient stock for product %', line_row.product_id;
    end if;

    insert into public.order_items (order_id, product_id, quantity, unit_price)
    values (order_row.id, line_row.product_id, line_row.quantity, unit_price);
  end loop;

  select *
  into order_row
  from public.orders
  where id = order_row.id;

  return order_row;
end;
$$;

revoke all on function public.create_stock_adjustment(uuid, numeric, public.stock_movement_type, text) from public;
revoke all on function public.create_production_run(uuid, numeric, text, date, jsonb, public.production_qc_status, text) from public;
revoke all on function public.create_dealer_order(jsonb) from public;
grant execute on function public.create_stock_adjustment(uuid, numeric, public.stock_movement_type, text) to authenticated;
grant execute on function public.create_production_run(uuid, numeric, text, date, jsonb, public.production_qc_status, text) to authenticated;
grant execute on function public.create_dealer_order(jsonb) to authenticated;
