-- Raw material purchase orders.
--
-- The PRD left this open ("whether raw material procurement/purchase orders are
-- in scope") and the answer was yes. Without it, the only way raw material
-- entered stock was a manual stock adjustment, which is indistinguishable from a
-- correction once written: nobody could tell a delivery from a miscount, and
-- there was no document to reconcile a supplier invoice against.
--
-- Receiving a PO writes into the existing stock_movements ledger as
-- source = 'purchase', with the PO id as the reference. That keeps one ledger
-- rather than a second stock track, so the product-level reconciliation that
-- already holds keeps holding.

create sequence if not exists public.purchase_order_number_seq;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_name text not null,
  supplier_gstin text,
  status public.purchase_order_status not null default 'draft',
  order_date date not null default private.business_date(),
  expected_date date,
  total_amount numeric(14, 2) not null default 0
    check (total_amount >= 0 and total_amount <> 'NaN'::numeric),
  notes text,
  received_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.purchase_orders is
  'Purchase orders for raw material. Receiving posts stock movements with source = purchase.';

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity numeric(14, 2) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  unit_price numeric(14, 2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  line_total numeric(14, 2),
  quantity_received numeric(14, 2) not null default 0
    check (quantity_received >= 0 and quantity_received <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  constraint purchase_order_lines_not_over_received
    check (quantity_received <= quantity)
);

create index if not exists purchase_order_lines_order_idx
  on public.purchase_order_lines (purchase_order_id);

create index if not exists purchase_orders_status_idx
  on public.purchase_orders (status);

create trigger set_updated_at_purchase_orders
  before update on public.purchase_orders
  for each row
  execute function public.set_updated_at();

-- Line totals are derived, never typed in.
create or replace function private.recalculate_purchase_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.purchase_orders
       set total_amount = coalesce((
             select sum(l.quantity * l.unit_price)
             from public.purchase_order_lines l
             where l.purchase_order_id = old.purchase_order_id
           ), 0)
     where id = old.purchase_order_id;
    return old;
  end if;

  update public.purchase_order_lines
     set line_total = round(new.quantity * new.unit_price, 2)
   where id = new.id;

  update public.purchase_orders
     set total_amount = coalesce((
           select sum(l.quantity * l.unit_price)
           from public.purchase_order_lines l
           where l.purchase_order_id = new.purchase_order_id
         ), 0)
   where id = new.purchase_order_id;

  return new;
end;
$$;

drop trigger if exists purchase_order_lines_total on public.purchase_order_lines;

create trigger purchase_order_lines_total
  before insert or update of quantity, unit_price on public.purchase_order_lines
  for each row
  execute function private.recalculate_purchase_order_total();

create trigger purchase_order_lines_total_delete
  after delete on public.purchase_order_lines
  for each row
  execute function private.recalculate_purchase_order_total();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;

drop policy if exists purchase_orders_select_scope on public.purchase_orders;

create policy purchase_orders_select_scope
  on public.purchase_orders
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'inventory_manager'::public.user_role,
        'production_manager'::public.user_role,
        'finance'::public.user_role
      ]
    )
  );

drop policy if exists purchase_orders_write_internal on public.purchase_orders;

create policy purchase_orders_write_internal
  on public.purchase_orders
  for all
  to authenticated
  using (
    private.current_user_role() = any (array['admin'::public.user_role, 'inventory_manager'::public.user_role])
  )
  with check (
    private.current_user_role() = any (array['admin'::public.user_role, 'inventory_manager'::public.user_role])
  );

drop policy if exists purchase_order_lines_select_scope on public.purchase_order_lines;

create policy purchase_order_lines_select_scope
  on public.purchase_order_lines
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'inventory_manager'::public.user_role,
        'production_manager'::public.user_role,
        'finance'::public.user_role
      ]
    )
  );

drop policy if exists purchase_order_lines_write_internal on public.purchase_order_lines;

create policy purchase_order_lines_write_internal
  on public.purchase_order_lines
  for all
  to authenticated
  using (
    private.current_user_role() = any (array['admin'::public.user_role, 'inventory_manager'::public.user_role])
  )
  with check (
    private.current_user_role() = any (array['admin'::public.user_role, 'inventory_manager'::public.user_role])
  );

revoke all on table public.purchase_orders, public.purchase_order_lines from anon, authenticated;
grant select on table public.purchase_orders, public.purchase_order_lines to authenticated;

-- quantity_received is written by receive_purchase_order, never by a client, so
-- a purchase order cannot be self-fulfilled from the browser.
grant insert (purchase_order_id, product_id, quantity, unit_price)
  on table public.purchase_order_lines to authenticated;

revoke all on sequence public.purchase_order_number_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Raise a purchase order
-- ---------------------------------------------------------------------------

create or replace function public.create_purchase_order(
  p_supplier_name text,
  p_supplier_gstin text,
  p_expected_date date,
  p_notes text,
  p_lines jsonb
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  order_row public.purchase_orders%rowtype;
  line_row record;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'inventory_manager') then
    raise exception 'Only inventory or admin can raise a purchase order';
  end if;

  if char_length(trim(coalesce(p_supplier_name, ''))) = 0 then
    raise exception 'Supplier name is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase order needs at least one line';
  end if;

  if p_expected_date is not null and p_expected_date < private.business_date() then
    raise exception 'Expected date cannot be in the past';
  end if;

  insert into public.purchase_orders (
    po_number,
    supplier_name,
    supplier_gstin,
    status,
    expected_date,
    notes,
    created_by
  )
  values (
    'PO-' || to_char(private.business_date(), 'YYYY') || '-' || lpad(nextval('public.purchase_order_number_seq')::text, 6, '0'),
    trim(p_supplier_name),
    nullif(trim(coalesce(p_supplier_gstin, '')), ''),
    'ordered',
    p_expected_date,
    nullif(trim(coalesce(p_notes, '')), ''),
    (select auth.uid())
  )
  returning * into order_row;

  for line_row in
    select product_id, sum(quantity)::numeric(14, 2) as quantity, max(unit_price) as unit_price
    from jsonb_to_recordset(p_lines)
      as requested(product_id uuid, quantity numeric, unit_price numeric)
    group by product_id
    order by product_id
  loop
    if line_row.product_id is null or line_row.quantity is null or line_row.quantity <= 0 then
      raise exception 'Each purchase order line needs a product and a positive quantity';
    end if;

    if line_row.unit_price is null or line_row.unit_price < 0 then
      raise exception 'Each purchase order line needs a unit price';
    end if;

    if not exists (
      select 1 from public.products p
      where p.id = line_row.product_id
        and p.active
        and not p.is_sellable
    ) then
      raise exception 'Product % is not a raw material', line_row.product_id;
    end if;

    insert into public.purchase_order_lines (purchase_order_id, product_id, quantity, unit_price)
    values (order_row.id, line_row.product_id, line_row.quantity, line_row.unit_price);
  end loop;

  select * into order_row from public.purchase_orders where id = order_row.id;

  return order_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Receive against a purchase order
-- ---------------------------------------------------------------------------

create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_lines jsonb
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  order_row public.purchase_orders%rowtype;
  receipt_row record;
  fully_received boolean;
  any_received boolean;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'inventory_manager') then
    raise exception 'Only inventory or admin can receive a purchase order';
  end if;

  select *
  into order_row
  from public.purchase_orders
  where id = p_purchase_order_id
  for update;

  if order_row.id is null then
    raise exception 'Purchase order % was not found', p_purchase_order_id;
  end if;

  if order_row.status in ('received', 'cancelled') then
    raise exception 'Purchase order % is % and cannot receive stock', order_row.po_number, order_row.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to receive';
  end if;

  for receipt_row in
    select
      r.line_id,
      r.quantity,
      l.id as matched_line_id,
      l.product_id,
      l.quantity - l.quantity_received as open_quantity
    from jsonb_to_recordset(p_lines)
      as r(line_id uuid, quantity numeric)
    -- Left join on purpose: an inner join would silently drop a line id that
    -- belongs to some other purchase order and the receipt would look complete.
    left join public.purchase_order_lines l
      on l.id = r.line_id
     and l.purchase_order_id = order_row.id
    order by r.line_id
  loop
    if receipt_row.matched_line_id is null then
      raise exception 'Receipt line % does not belong to purchase order %', receipt_row.line_id, order_row.po_number;
    end if;

    if receipt_row.quantity is null or receipt_row.quantity <= 0 then
      raise exception 'Receipt quantity must be positive';
    end if;

    if receipt_row.quantity > receipt_row.open_quantity then
      raise exception
        'Receipt of % exceeds the % still outstanding on this line',
        receipt_row.quantity, receipt_row.open_quantity;
    end if;

    -- Into the single existing ledger, tagged as a purchase so it can be told
    -- apart from a manual correction after the fact.
    insert into public.stock_movements (
      product_id,
      quantity,
      movement_type,
      source,
      reference_id,
      reason
    )
    values (
      receipt_row.product_id,
      receipt_row.quantity,
      'in',
      'purchase',
      order_row.id,
      'Received against ' || order_row.po_number
    );

    update public.purchase_order_lines
       set quantity_received = quantity_received + receipt_row.quantity
     where id = receipt_row.line_id;
  end loop;

  select
    coalesce(bool_and(quantity_received >= quantity), false),
    coalesce(bool_and(quantity_received > 0), false)
  into fully_received, any_received
  from public.purchase_order_lines
  where purchase_order_id = order_row.id;

  update public.purchase_orders
     set status = case
           when fully_received then 'received'::public.purchase_order_status
           when any_received then 'partially_received'::public.purchase_order_status
           else status
         end,
         received_at = case
           when fully_received then coalesce(received_at, now())
           else received_at
         end
   where id = order_row.id
  returning * into order_row;

  return order_row;
end;
$$;

revoke all on function public.create_purchase_order(text, text, date, text, jsonb) from public;
revoke all on function public.receive_purchase_order(uuid, jsonb) from public;
grant execute on function public.create_purchase_order(text, text, date, text, jsonb) to authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
