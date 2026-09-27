-- Requested delivery date, and sales reps placing orders on a dealer's behalf.
--
-- Two PRD gaps closed together because both change the same function:
--
--   * Section 6 asks a dealer to place orders with a "requested delivery" date.
--     Nothing captured it, so dispatch had no customer-stated date to plan
--     against.
--   * Section 5.1 asks a sales rep to "place/edit an order on a dealer's behalf",
--     which is how phone and WhatsApp orders get into the system. The old
--     create_dealer_order raised 'Only a dealer account can place orders' for
--     anyone else, and orders had no INSERT policy besides that function, so a
--     rep literally could not enter a dealer's order.
--
-- create_dealer_order is dropped and recreated rather than replaced: Postgres
-- treats (jsonb) and (jsonb, date, uuid) as different signatures, so a replace
-- would silently leave the old one-argument function behind and make PostgREST
-- ambiguous between the two.

alter table public.orders
  add column if not exists requested_delivery_date date;

comment on column public.orders.requested_delivery_date is
  'Delivery date the customer asked for. Advisory: dispatch still sets the actual dispatch_date.';

create index if not exists orders_requested_delivery_date_idx
  on public.orders (requested_delivery_date)
  where requested_delivery_date is not null;

drop function if exists public.create_dealer_order(jsonb);

create function public.create_dealer_order(
  order_lines jsonb,
  p_requested_delivery_date date default null,
  p_dealer_id uuid default null
)
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

  ------------------------------------------------------------------ who is asking
  if actor_role = 'dealer' then
    -- A dealer can only ever order for themselves. Passing a dealer id is
    -- accepted only when it agrees, so a crafted request cannot place an order
    -- against another account.
    dealer_id_value := private.current_dealer_id();

    if dealer_id_value is null then
      raise exception 'Dealer account is not linked to a dealer record';
    end if;

    if p_dealer_id is not null and p_dealer_id <> dealer_id_value then
      raise exception 'Dealers can only place orders for their own account';
    end if;
  elsif actor_role = 'sales_rep' then
    -- A rep acts for the dealers mapped to them, and only those. Mapping is read
    -- live rather than through the reporting hierarchy so that reassigning a
    -- dealer immediately moves that authority.
    if p_dealer_id is null then
      raise exception 'A sales rep must name the dealer the order is for';
    end if;

    if not exists (
      select 1
      from public.dealers d
      where d.id = p_dealer_id
        and d.sales_rep_id = (select auth.uid())
    ) then
      raise exception 'That dealer is not mapped to you';
    end if;

    dealer_id_value := p_dealer_id;
  elsif actor_role = 'admin' then
    -- Admin enters orders on the phone for any account, for data repair.
    if p_dealer_id is null then
      raise exception 'An admin order must name the dealer';
    end if;

    dealer_id_value := p_dealer_id;
  else
    raise exception 'Your role cannot place orders';
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

  -- A requested date in the past is always a typo, and accepting it would put an
  -- impossible promise in front of dispatch.
  if p_requested_delivery_date is not null
    and p_requested_delivery_date < private.business_date() then
    raise exception 'Requested delivery date cannot be in the past';
  end if;

  ------------------------------------------------------------------ header
  insert into public.orders (dealer_id, created_by, requested_delivery_date)
  values (dealer_id_value, (select auth.uid()), p_requested_delivery_date)
  returning * into order_row;

  ------------------------------------------------------------------ lines
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

revoke all on function public.create_dealer_order(jsonb, date, uuid) from public;
grant execute on function public.create_dealer_order(jsonb, date, uuid) to authenticated;
