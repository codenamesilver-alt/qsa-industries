-- Fix: a short delivery left the purchase order showing "ordered".
--
-- 20260926093700 decided the status after a receipt with
--
--   select
--     coalesce(bool_and(quantity_received >= quantity), false),   -- fully_received
--     coalesce(bool_and(quantity_received > 0), false)            -- any_received
--
-- bool_and is "every row is true", so the second one is not "did anything
-- arrive" at all. It is "did something arrive on every single line".
--
-- Ordered 200 maize and 100 soy. The supplier delivered the 50 maize and
-- nothing else. Then:
--
--   maize:  50 > 0   -> true
--   soy:     0 > 0   -> false
--   bool_and            -> false
--
-- fully_received is false, any_received is false, so the CASE fell through to
-- `else status` and the order stayed 'ordered' -- with 50 units of stock
-- received against it and no indication on the document that anything had
-- arrived. The order screen would show a live purchase order for goods that
-- were already in the warehouse.
--
-- The bug only shows when an entire line is untouched. A receipt that happens
-- to put something into every line takes the branch by accident, which is why
-- this survived being applied and looked right in the one shape that was tried.
--
-- bool_or is what the column name and the migration's own comment mean: "a short
-- delivery stays visible instead of silently closing the order".

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
    -- bool_or, not bool_and: "did anything arrive on this order" is true when a
    -- single line moved, even if every other line is still untouched.
    coalesce(bool_or(quantity_received > 0), false)
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

revoke all on function public.receive_purchase_order(uuid, jsonb) from public;
grant execute on function public.receive_purchase_order(uuid, jsonb) to authenticated;
