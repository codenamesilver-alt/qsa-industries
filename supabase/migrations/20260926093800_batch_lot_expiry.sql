-- Batch / lot tracking with expiry.
--
-- Additive by design. The product-level stock ledger is already reconciling
-- (level == sum of movements) and is proven by pgTAP, so it stays the source of
-- truth for availability. Batches are a second, parallel ledger that only
-- engages for a product that actually has batches: a movement with a null
-- batch_id is a movement for a product nobody batch-tracks, which is what keeps
-- the PRD's "optional batch/lot tracking" genuinely optional.
--
-- Expiry is enforced in two places:
--   * FEFO allocation on dispatch refuses to plan from an expired batch, and
--     refuses to ship a partial quantity when the unexpired batches fall short.
--   * The dealer catalog subtracts expired stock from the quantity a dealer can
--     order, so an expired batch is not sellable even before anyone dispatches.

-- ---------------------------------------------------------------------------
-- Batches
-- ---------------------------------------------------------------------------

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  batch_code text not null,
  manufacture_date date,
  expiry_date date not null,
  quantity_received numeric(14, 2) not null default 0
    check (quantity_received >= 0 and quantity_received <> 'NaN'::numeric),
  quantity_issued numeric(14, 2) not null default 0
    check (quantity_issued >= 0 and quantity_issued <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_batches_code_unique unique (product_id, batch_code),
  constraint product_batches_not_overissued check (quantity_issued <= quantity_received),
  constraint product_batches_expiry_after_manufacture
    check (manufacture_date is null or expiry_date >= manufacture_date)
);

comment on table public.product_batches is
  'Optional batch/lot ledger. Only engaged for products that have batches; other products leave stock_movements.batch_id null.';

create index if not exists product_batches_expiry_idx
  on public.product_batches (expiry_date)
  where quantity_issued < quantity_received;

create trigger set_updated_at_product_batches
  before update on public.product_batches
  for each row
  execute function public.set_updated_at();

alter table public.stock_movements
  add column if not exists batch_id uuid references public.product_batches (id);

create index if not exists stock_movements_batch_idx
  on public.stock_movements (batch_id)
  where batch_id is not null;

-- ---------------------------------------------------------------------------
-- Batch quantity maintenance
-- ---------------------------------------------------------------------------

create or replace function private.adjust_batch_quantity(
  target_batch_id uuid,
  delta numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.product_batches%rowtype;
  new_received numeric(14, 2);
  new_issued numeric(14, 2);
  issuing numeric(14, 2);
begin
  -- A null batch means the product is not batch tracked. Nothing to do, and
  -- deliberately not an error.
  if target_batch_id is null or delta = 0 then
    return;
  end if;

  select * into batch_row
  from public.product_batches
  where id = target_batch_id
  for update;

  if batch_row.id is null then
    raise exception 'Batch % was not found', target_batch_id;
  end if;

  new_received := batch_row.quantity_received + greatest(delta, 0);
  new_issued := batch_row.quantity_issued + greatest(-delta, 0);
  issuing := greatest(-delta, 0);

  if new_issued > new_received then
    raise exception
      'Batch % has only % left, cannot issue %',
      batch_row.batch_code,
      batch_row.quantity_received - batch_row.quantity_issued,
      issuing;
  end if;

  update public.product_batches
     set quantity_received = new_received,
         quantity_issued = new_issued,
         updated_at = now()
   where id = batch_row.id;
end;
$$;

create or replace function private.apply_batch_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_batch uuid;
  old_delta numeric(14, 2) := 0;
  new_batch uuid;
  new_delta numeric(14, 2) := 0;
begin
  if tg_op <> 'INSERT' then
    old_batch := old.batch_id;
    old_delta := case old.movement_type
      when 'in' then old.quantity
      else -old.quantity
    end;
  end if;

  if tg_op <> 'DELETE' then
    new_batch := new.batch_id;
    new_delta := case new.movement_type
      when 'in' then new.quantity
      else -new.quantity
    end;
  end if;

  -- Net delta for every case where the batch did not change, so a batch is never
  -- transiently wrong and the over-issue check reads the post-statement level.
  if old_batch is not distinct from new_batch then
    perform private.adjust_batch_quantity(new_batch, new_delta - old_delta);
  else
    perform private.adjust_batch_quantity(old_batch, -old_delta);
    perform private.adjust_batch_quantity(new_batch, new_delta);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists apply_batch_movement on public.stock_movements;

create trigger apply_batch_movement
  after insert or update or delete on public.stock_movements
  for each row
  execute function private.apply_batch_movement();

-- ---------------------------------------------------------------------------
-- First-expiry-first-out planning
-- ---------------------------------------------------------------------------

create or replace function private.allocate_batches_fefo(
  target_product_id uuid,
  target_quantity numeric
)
returns table (
  out_batch_id uuid,
  out_batch_code text,
  out_expiry_date date,
  out_quantity numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_count integer;
begin
  if target_quantity is null or target_quantity <= 0 then
    return;
  end if;

  -- Lock every batch for the product so two concurrent dispatches cannot both
  -- plan against the same availability.
  perform 1
  from public.product_batches
  where product_id = target_product_id
  for update;

  select count(*) into batch_count
  from public.product_batches
  where product_id = target_product_id;

  -- Not batch tracked: the whole quantity ships unallocated.
  if batch_count = 0 then
    return query
    select null::uuid, null::text, null::date, target_quantity::numeric;
    return;
  end if;

  return query
  with usable as (
    select
      b.id,
      b.batch_code,
      b.expiry_date,
      b.quantity_received - b.quantity_issued as available_quantity
    from public.product_batches b
    where b.product_id = target_product_id
      -- Usable through the expiry date itself; expired the day after.
      and b.expiry_date >= private.business_date()
      and b.quantity_received > b.quantity_issued
  ),
  running as (
    select
      u.*,
      coalesce(
        sum(u.available_quantity) over (
          order by u.expiry_date, u.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      ) as already_planned
    from usable u
  )
  select
    r.id,
    r.batch_code,
    r.expiry_date,
    least(r.available_quantity, greatest(target_quantity - r.already_planned, 0))::numeric
  from running r
  where r.already_planned < target_quantity
  order by r.expiry_date, r.id;
end;
$$;

comment on function private.allocate_batches_fefo(uuid, numeric) is
  'Plans a quantity against a product''s unexpired batches, earliest expiry first. Returns a single unallocated row for products with no batches.';

-- ---------------------------------------------------------------------------
-- Record a batch receipt
-- ---------------------------------------------------------------------------

create or replace function public.receive_into_batch(
  p_product_id uuid,
  p_batch_code text,
  p_manufacture_date date,
  p_expiry_date date,
  p_quantity numeric,
  p_source public.stock_movement_source,
  p_reference_id uuid,
  p_reason text
)
returns public.product_batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  batch_row public.product_batches%rowtype;
begin
  actor_role := private.current_user_role();

  if actor_role is null
    or actor_role not in ('admin', 'inventory_manager', 'production_manager') then
    raise exception 'Only inventory, production or admin can receive a batch';
  end if;

  if char_length(trim(coalesce(p_batch_code, ''))) = 0 then
    raise exception 'Batch code is required';
  end if;

  if p_expiry_date is null then
    raise exception 'Expiry date is required for a batch';
  end if;

  if p_expiry_date < private.business_date() then
    raise exception 'Expiry date cannot be in the past';
  end if;

  if p_manufacture_date is not null and p_manufacture_date > p_expiry_date then
    raise exception 'Manufacture date cannot be after the expiry date';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Receipt quantity must be positive';
  end if;

  if not exists (select 1 from public.products where id = p_product_id and active) then
    raise exception 'Product % is not available', p_product_id;
  end if;

  if p_source not in ('production', 'purchase', 'adjustment', 'opening_balance') then
    raise exception 'A batch cannot be received from source %', p_source;
  end if;

  insert into public.product_batches (
    product_id,
    batch_code,
    manufacture_date,
    expiry_date
  )
  values (
    p_product_id,
    trim(p_batch_code),
    p_manufacture_date,
    p_expiry_date
  )
  on conflict (product_id, batch_code)
  do update set manufacture_date = excluded.manufacture_date,
                expiry_date = excluded.expiry_date
  returning * into batch_row;

  -- The movement is what actually moves the quantity; the trigger on
  -- stock_movements credits the batch.
  insert into public.stock_movements (
    product_id,
    quantity,
    movement_type,
    source,
    reference_id,
    reason,
    batch_id
  )
  values (
    p_product_id,
    p_quantity,
    'in',
    p_source,
    p_reference_id,
    nullif(trim(coalesce(p_reason, '')), ''),
    batch_row.id
  );

  return batch_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiry reporting
-- ---------------------------------------------------------------------------

create or replace view public.expiring_batches
with (security_invoker = true)
as
select
  b.id as batch_id,
  b.product_id,
  p.sku,
  p.name as product_name,
  b.batch_code,
  b.manufacture_date,
  b.expiry_date,
  b.quantity_received - b.quantity_issued as available_quantity,
  (b.expiry_date - private.business_date()) as days_remaining,
  case
    when b.expiry_date < private.business_date() then 'expired'
    when b.expiry_date <= private.business_date() + 30 then 'critical'
    when b.expiry_date <= private.business_date() + 60 then 'warning'
    else 'ok'
  end as expiry_status
from public.product_batches b
join public.products p on p.id = b.product_id
where b.quantity_received > b.quantity_issued;

grant select on public.expiring_batches to authenticated;

-- ---------------------------------------------------------------------------
-- Expired stock is not sellable
-- ---------------------------------------------------------------------------

drop view if exists public.dealer_catalog;

create view public.dealer_catalog
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
  -- available_quantity is left exactly as it was so the existing ledger check
  -- keeps its meaning; sellable_quantity is what a dealer may actually order.
  greatest(
    coalesce(s.current_quantity, 0) - coalesce(exp.expired_quantity, 0),
    0
  ) as sellable_quantity,
  exp.earliest_expiry_date,
  p.low_stock_threshold
from products p
left join stock_levels s
  on s.product_id = p.id
left join lateral (
  select price_lists.price
  from price_lists
  where price_lists.product_id = p.id
    and (
      price_lists.dealer_id = (select private.current_dealer_id() as current_dealer_id)
      or (
        price_lists.dealer_id is null
        and price_lists.price_tier = 'standard_dealer'::text
      )
    )
    and (price_lists.valid_from is null or price_lists.valid_from <= private.business_date())
    and (price_lists.valid_to is null or price_lists.valid_to >= private.business_date())
  order by (price_lists.dealer_id is not null) desc,
           price_lists.valid_from desc nulls last,
           price_lists.id desc
  limit 1
) pl on true
left join lateral (
  select
    sum(
      case
        when b.expiry_date < private.business_date()
          then b.quantity_received - b.quantity_issued
        else 0
      end
    ) as expired_quantity,
    min(
      case
        when b.expiry_date >= private.business_date()
         and b.quantity_received > b.quantity_issued
          then b.expiry_date
      end
    ) as earliest_expiry_date
  from public.product_batches b
  where b.product_id = p.id
) exp on true
where p.active and p.is_sellable;

grant select on public.dealer_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- Dispatch consumes batches earliest-expiry-first
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_order(
  target_order_id uuid,
  dispatch_date_value date default private.business_date(),
  dispatch_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  actor_role public.user_role;
  item_row record;
  alloc_row record;
  planned numeric(14, 2);
begin
  actor_role := private.current_user_role();

  select *
  into order_row
  from public.orders
  where id = target_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  if actor_role is null or actor_role not in ('admin', 'logistics') then
    raise exception 'Only logistics can dispatch orders';
  end if;

  if order_row.status <> 'approved' then
    raise exception 'Only approved orders can be dispatched';
  end if;

  if dispatch_date_value is null then
    raise exception 'Dispatch date is required';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Dealer account is not active';
  end if;

  update public.orders
  set status = 'dispatched',
      dispatch_date = dispatch_date_value,
      dispatched_at = now(),
      tracking_note = nullif(trim(dispatch_note), '')
  where id = order_row.id;

  -- Plan each line against its batches before writing anything, so a short
  -- unexpired quantity aborts the whole dispatch instead of half-shipping it.
  for item_row in
    select oi.product_id, oi.quantity
    from public.order_items as oi
    where oi.order_id = order_row.id
    order by oi.product_id
  loop
    planned := 0;

    for alloc_row in
      select * from private.allocate_batches_fefo(item_row.product_id, item_row.quantity)
    loop
      insert into public.stock_movements (
        product_id,
        quantity,
        movement_type,
        source,
        reference_id,
        reason,
        batch_id,
        created_by
      )
      values (
        item_row.product_id,
        alloc_row.out_quantity,
        'out',
        'sales',
        order_row.id,
        'Order dispatch',
        alloc_row.out_batch_id,
        (select auth.uid())
      );

      planned := planned + alloc_row.out_quantity;
    end loop;

    if round(planned, 2) <> round(item_row.quantity, 2) then
      raise exception
        'Order % needs % of product %, but only % of unexpired batch stock is available',
        order_row.order_number,
        item_row.quantity,
        item_row.product_id,
        planned;
    end if;
  end loop;

  select * into order_row from public.orders where id = order_row.id;
  return order_row;
end;
$$;

revoke all on function public.dispatch_order(uuid, date, text) from public;
grant execute on function public.dispatch_order(uuid, date, text) to authenticated;

revoke all on function public.receive_into_batch(uuid, text, date, date, numeric, public.stock_movement_source, uuid, text) from public;
grant execute on function public.receive_into_batch(uuid, text, date, date, numeric, public.stock_movement_source, uuid, text) to authenticated;
