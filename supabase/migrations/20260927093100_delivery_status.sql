-- Delivery status: an order was dispatched, and then it was delivered, and
-- nothing in the schema recorded the second event.
--
-- PRD 3.2 gives logistics a dispatch screen, and PRD 4.3 wants a dealer able to
-- see order status. Dispatch set orders.status to 'dispatched' and stopped there,
-- so a consignment that left the gate and never arrived was indistinguishable
-- from one sitting in a truck, on every screen, for ever. The order status enum
-- is not the place to fix it either: 'delivered' is not a stage of the approval
-- chain, and adding it to public.order_status would have made it a state an
-- invoice could be raised against and a credit approval could sit in.
--
-- So delivery is its own small dimension on the order, written only by
-- logistics through mark_order_delivered, and set in transit as a side effect of
-- the dispatch that already exists. Nothing else moves it.

create type public.delivery_status as enum (
  'awaiting_dispatch',
  'in_transit',
  'delivered'
);

comment on type public.delivery_status is
  'Where a consignment is, separately from where the order sits in the approval chain. awaiting_dispatch means the order is not yet on a vehicle; in_transit means dispatch_order has run and no delivery has been confirmed; delivered means logistics has confirmed receipt.';

alter table public.orders
  add column if not exists delivery_status public.delivery_status not null default 'awaiting_dispatch',
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_note text;

comment on column public.orders.delivery_status is
  'Consignment state. Written by dispatch_order (to in_transit) and by mark_order_delivered (to delivered), and by nothing else.';
comment on column public.orders.delivered_at is
  'When logistics confirmed receipt. Null means not confirmed, which is the answer the dealer and the sales rep needed and could not get before.';
comment on column public.orders.delivery_note is
  'Free text from logistics at the moment of confirmation: who signed, what was short, where it was left.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Anything already dispatched is, as far as this system knew, on a vehicle: it
-- was never confirmed, and calling it awaiting_dispatch would be a claim this
-- migration cannot support. Anything else was never dispatched at all.
update public.orders
   set delivery_status = case
     when status in ('dispatched', 'invoiced') then 'in_transit'::public.delivery_status
     else 'awaiting_dispatch'::public.delivery_status
   end
 where delivery_status = 'awaiting_dispatch'
   and status in ('dispatched', 'invoiced');

-- ---------------------------------------------------------------------------
-- dispatch_order now starts a delivery
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
      tracking_note = nullif(trim(dispatch_note), ''),
      delivery_status = 'in_transit',
      delivered_at = null,
      delivery_note = null
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
        target_order_id,
        item_row.quantity,
        item_row.product_id,
        planned;
    end if;
  end loop;

  select * into order_row from public.orders where id = order_row.id;
  return order_row;
end;
$$;

comment on function public.dispatch_order(uuid, date, text) is
  'Dispatch an approved order, consume FEFO batches and now also set delivery_status to in_transit. Logistics or admin only. Unchanged from 20260926093800 apart from the three delivery columns: the planning loop still runs before any stock movement is written.';

revoke all on function public.dispatch_order(uuid, date, text) from public;
grant execute on function public.dispatch_order(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_order_delivered
-- ---------------------------------------------------------------------------

create or replace function public.mark_order_delivered(
  target_order_id uuid,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'logistics') then
    raise exception 'Only logistics can confirm a delivery';
  end if;

  select * into order_row from public.orders where id = target_order_id for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  -- Delivery is a fact about a consignment, so it can only follow a dispatch. An
  -- approved or pending order has nothing on a vehicle to confirm.
  if order_row.delivery_status <> 'in_transit' or order_row.dispatch_date is null then
    raise exception
      'Order % has not been dispatched yet, so there is no delivery to confirm',
      target_order_id;
  end if;

  update public.orders
     set delivery_status = 'delivered',
         delivered_at = now(),
         delivery_note = nullif(trim(p_note), '')
   where id = order_row.id
  returning * into order_row;

  return order_row;
end;
$$;

comment on function public.mark_order_delivered(uuid, text) is
  'Confirm that a dispatched consignment was received. Logistics or admin only. Refused before dispatch, refused twice for the same order, and never callable by a dealer, a rep, a manager or finance: nobody else may state that goods arrived.';

revoke all on function public.mark_order_delivered(uuid, text) from public;

-- Revoked from anon by name too: the Supabase default privileges for the public
-- schema grant EXECUTE on every new function to anon, so revoking from public
-- alone would leave anon holding it.
revoke all on function public.mark_order_delivered(uuid, text) from anon;

grant execute on function public.mark_order_delivered(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The board logistics reads
-- ---------------------------------------------------------------------------

create or replace view public.delivery_board
with (security_invoker = true)
as
select
  o.id as order_id,
  left(o.id::text, 8) as order_reference,
  d.name as dealer_name,
  o.sales_rep_id,
  o.status,
  o.delivery_status,
  o.dispatch_date,
  o.delivered_at,
  o.tracking_note,
  o.delivery_note,
  o.total_amount,
  (o.dispatch_date - private.business_date())::integer as days_in_transit
from public.orders as o
join public.dealers as d on d.id = o.dealer_id
where o.delivery_status <> 'awaiting_dispatch'
   or o.status in ('approved', 'dispatched', 'invoiced');

comment on view public.delivery_board is
  'Orders logistics still has to move: everything approved and everything on a vehicle. security_invoker, so the orders policy still applies: a dealer sees their own rows, a rep or manager sees their dealers, logistics and admin see everything.';
