-- Edit a dealer order while it is still pending.
--
-- PRD section 5.1 asks a sales rep to "place/edit an order on a dealer's
-- behalf". 20260926093300 closed the "place" half and left "edit" open, because
-- editing an order is a different question from creating one: a created order is
-- an assertion, an edit is a correction, and who may make it and what it costs
-- are both questions the function has to answer rather than inherit.
--
-- The agreed rules, decided on 28 September 2026:
--
--   * Only status = 'pending'. Once a manager has approved, the approval is a
--     credit decision taken on a specific set of lines and a specific total.
--     Changing either underneath it would leave a credit check that never
--     happened, and an approval row that describes an order that no longer
--     exists. Re-approval is a separate act, not an edit.
--   * Price is recalculated from the current catalogue and price list, not taken
--     from the request. An edit that could set its own price would let a rep
--     rewrite what a dealer owes, which is a pricing change and not a
--     correction.
--   * Stock is re-checked against the current level, for the same reason price
--     is re-read: a line can be raised past what is left even if the original
--     order fitted.
--
-- Two consequences of re-pricing are deliberate. The order total changes, and
-- because the order is still pending it has not been counted against the dealer's
-- credit exposure yet, so nothing has to be unwound there. Once the edit is
-- approved, the exposure snapshot in order_approvals is taken from the new total
-- like any other approval.
--
-- Authority is deliberately identical to create_dealer_order: a dealer edits only
-- their own orders, a rep edits only orders for dealers mapped to them, admin
-- edits any. The check is on the order's existing dealer, not on an argument,
-- so a crafted call cannot redirect an edit onto a different account.

create or replace function public.edit_dealer_order(
  target_order_id uuid,
  order_lines jsonb,
  p_requested_delivery_date date default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  line_row record;
  existing_dealer uuid;
  dealer_id_value uuid;
  list_price numeric(14, 2);
  available_quantity numeric(14, 2);
  unit_price numeric(14, 2);
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  ------------------------------------------------------------------ who is asking
  if actor_role is null then
    raise exception 'You must be signed in to edit an order';
  end if;

  select dealer_id
  into existing_dealer
  from public.orders
  where id = target_order_id;

  if existing_dealer is null then
    raise exception 'Order % does not exist', target_order_id;
  end if;

  if actor_role = 'dealer' then
    dealer_id_value := private.current_dealer_id();

    if dealer_id_value is null then
      raise exception 'Dealer account is not linked to a dealer record';
    end if;

    if existing_dealer <> dealer_id_value then
      raise exception 'Dealers can only edit their own orders';
    end if;
  elsif actor_role = 'sales_rep' then
    if not exists (
      select 1
      from public.dealers d
      where d.id = existing_dealer
        and d.sales_rep_id = (select auth.uid())
    ) then
      raise exception 'That order is not for a dealer mapped to you';
    end if;

    dealer_id_value := existing_dealer;
  elsif actor_role = 'admin' then
    dealer_id_value := existing_dealer;
  else
    raise exception 'Your role cannot edit orders';
  end if;

  ------------------------------------------------------------------ state check
  -- Read fresh inside the check rather than trusting a value passed in, so the
  -- status and the dealer read the same row.
  if (select status from public.orders where id = target_order_id) <> 'pending' then
    raise exception 'Only a pending order can be edited';
  end if;

  if not exists (
    select 1
    from public.dealers
    where id = dealer_id_value
      and status = 'active'
  ) then
    raise exception 'Dealer account is not active';
  end if;

  ------------------------------------------------------------------ sanity checks
  if order_lines is null or jsonb_typeof(order_lines) <> 'array' then
    raise exception 'Order lines must be a JSON array';
  end if;

  if jsonb_array_length(order_lines) = 0 then
    raise exception 'At least one order line is required';
  end if;

  if p_requested_delivery_date is not null
    and p_requested_delivery_date < private.business_date() then
    raise exception 'Requested delivery date cannot be in the past';
  end if;

  ------------------------------------------------------------------ price into staging
  -- Priced once, into a staging table, rather than priced in a validation loop
  -- and again in an insert loop. Two copies of the same pricing query in one
  -- function is exactly the shape that lets an edit and a create drift apart
  -- later, so the query runs once and the insert reads what it computed.
  create temporary table edit_lines (
    product_id uuid primary key,
    quantity numeric(14, 2) not null,
    unit_price numeric(14, 2) not null
  ) on commit drop;

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

    -- A pending order holds no stock, so the full requested quantity has to be
    -- available. The old lines are being replaced, not added to, so they are not
    -- netted off here.
    if available_quantity < line_row.quantity then
      raise exception 'Insufficient stock for product %', line_row.product_id;
    end if;

    insert into edit_lines (product_id, quantity, unit_price)
    values (line_row.product_id, line_row.quantity, unit_price);
  end loop;

  if (select count(*) from edit_lines) = 0 then
    raise exception 'At least one order line is required';
  end if;

  ------------------------------------------------------------------ write
  -- The old lines go before the new ones land, so the order is never briefly
  -- holding lines it cannot pay for. total_amount is a stored column maintained by
  -- a trigger on order_items that fires per row, so the delete drops it to zero and
  -- the last insert leaves the new total behind. The header update touches neither
  -- the total nor the status, so it cannot disturb the credit position.
  delete from public.order_items where order_id = target_order_id;

  update public.orders
  set requested_delivery_date = p_requested_delivery_date
  where id = target_order_id;

  insert into public.order_items (order_id, product_id, quantity, unit_price)
  select target_order_id, product_id, quantity, unit_price
  from edit_lines
  order by product_id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

revoke all on function public.edit_dealer_order(uuid, jsonb, date) from public;
grant execute on function public.edit_dealer_order(uuid, jsonb, date) to authenticated;

comment on function public.edit_dealer_order(uuid, jsonb, date) is
  'Replace the lines and requested delivery date of a pending order. Price is re-read from the catalogue and stock is re-checked; neither is taken from the request. Refused once the order is no longer pending, because an approval is a credit decision taken on a specific total.';
