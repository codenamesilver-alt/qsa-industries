-- Production output has to land in a batch, or FEFO cannot ship it.
--
-- private.allocate_batches_fefo plans a dispatch against product_batches only,
-- and falls back to an unallocated row only when the product has no batches at
-- all. The moment a product has one batch, that fallback is gone. Production
-- output, meanwhile, was writing a stock movement with batch_id null. So for a
-- product that is batch tracked, output from the plant raised stock_levels,
-- satisfied the approval-time stock check, and then could not be dispatched:
-- logistics met "only N of unexpired batch stock is available" on an order that
-- had already been approved. The order was unshippable from the moment it was
-- approved, and nothing said so until the last step.
--
-- This closes both halves:
--
--   1. Output is batched whenever the product is perishable (shelf_life_days) or
--      already carries batches, so batched stock and batch-tracked stock cannot
--      drift apart again.
--   2. Approval refuses an order that could not be dispatched, so the failure
--      surfaces to the sales manager while there is still something to do about
--      it, rather than to logistics at the loading bay.
--
-- shelf_life_days is deliberately left null on every existing product. How long
-- QSA's feed keeps is the product master's call and the accountant's to confirm,
-- and guessing it would invent a shelf life that then drives expiry dates and
-- FEFO ordering. Null means "not perishable", which is the safe and correct
-- default for a product with no batch history.

alter table public.products
  add column if not exists shelf_life_days integer;

comment on column public.products.shelf_life_days is
  'Days from manufacture to expiry. Null means the product is not perishable and '
  'carries no batch. When set, production output is recorded as a batch whose '
  'expiry is the run date plus this many days, and dispatch draws it FEFO.';

alter table public.products
  drop constraint if exists products_shelf_life_days_positive;

alter table public.products
  add constraint products_shelf_life_days_positive
  check (shelf_life_days is null or (shelf_life_days > 0 and shelf_life_days <= 3650));

-- ---------------------------------------------------------------------------
-- Does this product need a batch for its output?
-- ---------------------------------------------------------------------------
create or replace function private.production_requires_batch(target_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- Already batch tracked, or perishable by its own shelf life. Either way the
    -- output has to be batched or it becomes stock nothing can dispatch.
    exists (select 1 from public.product_batches b where b.product_id = target_product_id)
    or exists (select 1 from public.products p where p.id = target_product_id and p.shelf_life_days is not null);
$$;

comment on function private.production_requires_batch(uuid) is
  'True when production output for this product must be recorded as a batch: the '
  'product is perishable, or it already carries batches and an unbatched receipt '
  'would leave stock that FEFO cannot plan against.';

-- ---------------------------------------------------------------------------
-- Record production output, batching it when the product requires it
-- ---------------------------------------------------------------------------
create or replace function private.record_production_output()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_batch_id uuid;
  new_batch_code text;
  shelf_days integer;
  expiry_value date;
begin
  if new.qc_status <> 'passed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.qc_status = 'passed' then
    return new;
  end if;

  if exists (
    select 1
    from public.stock_movements
    where source = 'production'
      and reference_id = new.id
      and reason = 'Production output'
  ) then
    return new;
  end if;

  if private.production_requires_batch(new.product_id) then
    select p.shelf_life_days
    into shelf_days
    from public.products p
    where p.id = new.product_id;

    if shelf_days is not null then
      expiry_value := new.run_date + shelf_days;
    else
      -- Already batch tracked but no shelf life on file, so the expiry cannot be
      -- derived. Refusing is the only honest option: defaulting to next month
      -- would quietly invent a shelf life and then drive FEFO from it.
      raise exception
        'Cannot record production output for product %: it already carries batches but has no shelf life set. Set shelf_life_days on the product, or remove its batches.',
        new.product_id;
    end if;

    if expiry_value < private.business_date() then
      raise exception
        'Cannot record production output for product %: a batch made on % with a %-day shelf life expired on %',
        new.product_id, new.run_date, shelf_days, expiry_value;
    end if;

    -- Derived from the run date and the run id, so re-running the trigger cannot
    -- create a second batch: the run id is already unique and the guard above
    -- stops a duplicate movement in the first place.
    new_batch_code := 'PRP-' || to_char(new.run_date, 'YYYYMMDD') || '-' || upper(left(new.id::text, 8));

    insert into public.product_batches (
      product_id,
      batch_code,
      manufacture_date,
      expiry_date
    )
    values (
      new.product_id,
      new_batch_code,
      new.run_date,
      expiry_value
    )
    on conflict (product_id, batch_code)
    do update set manufacture_date = excluded.manufacture_date,
                  expiry_date = excluded.expiry_date
    returning id into new_batch_id;
  end if;

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
    new.product_id,
    new.quantity_produced,
    'in',
    'production',
    new.id,
    'Production output',
    new_batch_id,
    new.created_by
  );

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval has to respect what can actually be dispatched
--
-- For a batch tracked product the stock_levels figure is no longer the whole
-- truth: expired batches are in stock_levels and cannot ship. Checking only
-- stock_levels is what let an unshippable order be approved in the first place.
-- ---------------------------------------------------------------------------
create or replace function private.assert_order_stock_available(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row record;
  available_quantity numeric(14, 2);
  unexpired_quantity numeric(14, 2);
begin
  for item_row in
    select product_id, sum(quantity)::numeric(14, 2) as required_quantity
    from public.order_items
    where order_id = target_order_id
    group by product_id
    order by product_id
  loop
    select current_quantity
    into available_quantity
    from public.stock_levels
    where product_id = item_row.product_id
    for update;

    if not found or coalesce(available_quantity, 0) < item_row.required_quantity then
      raise exception 'Insufficient stock for product % while approving order %',
        item_row.product_id,
        target_order_id;
    end if;

    -- Only for batch tracked products. For everything else the unexpired total is
    -- the same as stock_levels and this is skipped.
    if private.production_requires_batch(item_row.product_id) then
      select coalesce(sum(b.quantity_received - b.quantity_issued), 0)
      into unexpired_quantity
      from public.product_batches b
      where b.product_id = item_row.product_id
        and b.expiry_date >= private.business_date();

      if unexpired_quantity < item_row.required_quantity then
        raise exception
          'Product % has % in stock but only % unexpired and shippable, so order % cannot be filled',
          item_row.product_id,
          coalesce(available_quantity, 0),
          unexpired_quantity,
          target_order_id;
      end if;
    end if;
  end loop;
end;
$$;

comment on function private.assert_order_stock_available(uuid) is
  'Refuses to let an order be approved unless every line can be dispatched. For '
  'batch tracked products it checks unexpired batch stock, not just stock_levels, '
  'because expired stock is on the books but cannot ship.';
