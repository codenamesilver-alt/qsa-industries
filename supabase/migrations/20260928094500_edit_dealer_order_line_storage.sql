-- Fix two defects in edit_dealer_order and dealer_catalog_for, both found by the
-- stage13 suite rather than by reading the code.
--
-- 1. The staging table was created with a column named unit_price, and the loop
--    inserted into it with an unqualified `values (..., unit_price)`. PL/pgSQL
--    substituted the column reference in preference to the local variable, so
--    every call failed with
--       column reference "unit_price" is ambiguous
--    Nothing in the function had ever run.
--
--    It is replaced with parallel local arrays. That fixes the collision, and it
--    fixes a second fault the first one was hiding: `create temporary table` inside
--    a function is session-scoped, not call-scoped, so a second edit in the same
--    transaction would have failed on "relation edit_lines already exists". A
--    dealer correcting two orders, or a batch job running both fixes, is an
--    ordinary thing to do. Local arrays have no session lifetime to get wrong and
--    keep the price-once property: the pricing query still runs exactly once per
--    line, and the insert reads what it computed.
--
-- 2. Supabase's default privileges for the public schema grant EXECUTE on every new
--    function to anon, so `revoke ... from public` alone left anon holding EXECUTE
--    on edit_dealer_order and dealer_catalog_for. Both are revoked from anon by
--    name now, the same treatment 20260927093100 gave mark_order_delivered. The
--    role checks inside the functions would refuse an anonymous call anyway, but a
--    function that answers unauthenticated callers with a bespoke error is a
--    function whose authority checks are one refactor away from being load-bearing.

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
  line_price numeric(14, 2);
  actor_role public.user_role;
  -- Priced lines, accumulated as the loop goes. Appended in the same
  -- product_id order the loop reads them, so the insert is deterministic.
  priced_product_ids uuid[] := '{}';
  priced_quantities numeric(14, 2)[] := '{}';
  priced_prices numeric(14, 2)[] := '{}';
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

  ------------------------------------------------------------------ price and validate
  -- Priced once, into local arrays, rather than priced in a validation loop and
  -- again in an insert loop. Two copies of the same pricing query in one function
  -- is exactly the shape that lets an edit and a create drift apart later.
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
      line_price
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

    priced_product_ids := array_append(priced_product_ids, line_row.product_id);
    priced_quantities := array_append(priced_quantities, line_row.quantity);
    priced_prices := array_append(priced_prices, line_price);
  end loop;

  if array_length(priced_product_ids, 1) is null then
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
  select
    target_order_id,
    priced.product_id,
    priced.quantity,
    priced.unit_price
  from unnest(priced_product_ids, priced_quantities, priced_prices)
    as priced(product_id, quantity, unit_price)
  order by priced.product_id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

revoke all on function public.edit_dealer_order(uuid, jsonb, date) from public;
-- Revoked from anon by name too: the Supabase default privileges for the public
-- schema grant EXECUTE on every new function to anon, so revoking from public
-- alone would leave anon holding it.
revoke all on function public.edit_dealer_order(uuid, jsonb, date) from anon;
grant execute on function public.edit_dealer_order(uuid, jsonb, date) to authenticated;

revoke all on function public.dealer_catalog_for(uuid) from anon;
grant execute on function public.dealer_catalog_for(uuid) to authenticated;

revoke all on function private.dealer_unit_price(uuid, uuid) from anon;
grant execute on function private.dealer_unit_price(uuid, uuid) to authenticated;
