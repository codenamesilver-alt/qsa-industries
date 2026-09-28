-- Price a catalogue for a named dealer.
--
-- Why this exists: create_dealer_order and edit_dealer_order price a line against
-- the order's own dealer, so a dealer with its own price list is charged its own
-- price from the moment the order is written, not at approval. public.dealer_catalog,
-- the view both dealer screens read, could not show that. It resolves the price
-- against private.current_dealer_id(), which is null for a rep or an admin, so it
-- fell through to the standard_dealer tier and displayed a total the database was
-- never going to charge whenever the dealer had a custom list. The stored
-- unit_price was right; only the preview was wrong. approve_order does not
-- re-price, so nothing downstream corrected it either.
--
-- The fix is one pricing function with two callers rather than two queries:
--
--   private.dealer_unit_price(product, dealer)  the resolution order, in one place
--   public.dealer_catalog                       the caller's own dealer, unchanged shape
--   public.dealer_catalog_for(dealer)           a named dealer, after an authority check
--
-- private.dealer_unit_price is SECURITY DEFINER on purpose. dealer_catalog is
-- security_invoker, so if the view read price_lists directly it would be filtered by
-- price_lists_select_scope, which hides future-dated rows from everyone but the
-- function owner. That gap already made the view show a different price from the
-- one create_dealer_order charges for any future-dated list. Routing the view
-- through the definer function closes it: what a screen shows and what an order is
-- charged now come from the same rows, by construction.
--
-- Resolution order, unchanged from create_dealer_order: a price named for this
-- dealer wins over a tier price, and the most specific valid row wins overall.

create or replace function private.dealer_unit_price(target_product_id uuid, target_dealer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select pl.price
      from public.price_lists as pl
      where pl.product_id = target_product_id
        and (
          pl.dealer_id = target_dealer_id
          or (pl.dealer_id is null and pl.price_tier = 'standard_dealer')
        )
        and (pl.valid_from is null or pl.valid_from <= private.business_date())
        and (pl.valid_to is null or pl.valid_to >= private.business_date())
      order by (pl.dealer_id is not null) desc, pl.valid_from desc nulls last, pl.id desc
      limit 1
    ),
    (select p.price from public.products as p where p.id = target_product_id)
  );
$$;

revoke all on function private.dealer_unit_price(uuid, uuid) from public;

comment on function private.dealer_unit_price(uuid, uuid) is
  'The price this dealer pays for this product: its own price list first, then the standard_dealer tier, then the catalogue list price. One definition, shared by every screen and every order function, so a displayed price and a charged price cannot disagree.';

-- ---------------------------------------------------------------------------
-- The existing view, same columns, same rows, now reading the shared function.
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
  private.dealer_unit_price(p.id, private.current_dealer_id()) as unit_price,
  coalesce(s.current_quantity, 0) as available_quantity,
  -- available_quantity is left exactly as it was so the existing ledger check
  -- keeps its meaning; sellable_quantity is what a dealer may actually order.
  greatest(
    coalesce(s.current_quantity, 0) - coalesce(exp.expired_quantity, 0),
    0
  ) as sellable_quantity,
  exp.earliest_expiry_date,
  p.low_stock_threshold
from public.products as p
left join public.stock_levels as s
  on s.product_id = p.id
left join lateral private.batch_stock_summary(p.id) as exp on true
where p.active and p.is_sellable;

grant select on table public.dealer_catalog to authenticated;

-- ---------------------------------------------------------------------------

create or replace function public.dealer_catalog_for(target_dealer_id uuid)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  category text,
  unit_of_measure text,
  list_price numeric,
  unit_price numeric,
  available_quantity numeric,
  sellable_quantity numeric,
  earliest_expiry_date date,
  low_stock_threshold numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  caller_dealer uuid;
begin
  actor_role := private.current_user_role();

  if actor_role is null then
    raise exception 'You must be signed in to view a dealer catalogue';
  end if;

  if target_dealer_id is null then
    raise exception 'A dealer must be named';
  end if;

  if not exists (
    select 1
    from public.dealers
    where id = target_dealer_id
      and status = 'active'
  ) then
    raise exception 'Dealer account is not active';
  end if;

  -- Deliberately the same three-way authority as create_dealer_order and
  -- edit_dealer_order. A catalogue read reveals what a dealer pays, so a rep may
  -- only price the dealers they are mapped to and a sales manager, whose word
  -- carries no proxy authority anywhere else in the system, gets none here either.
  if actor_role = 'dealer' then
    caller_dealer := private.current_dealer_id();

    if caller_dealer is distinct from target_dealer_id then
      raise exception 'Dealers can only view their own catalogue';
    end if;
  elsif actor_role = 'sales_rep' then
    if not exists (
      select 1
      from public.dealers as d
      where d.id = target_dealer_id
        and d.sales_rep_id = (select auth.uid())
    ) then
      raise exception 'That dealer is not mapped to you';
    end if;
  elsif actor_role <> 'admin' then
    raise exception 'Your role cannot view a dealer catalogue';
  end if;

  return query
  select
    p.id,
    p.sku,
    p.name,
    p.category,
    p.unit_of_measure,
    p.price,
    private.dealer_unit_price(p.id, target_dealer_id),
    coalesce(s.current_quantity, 0),
    greatest(
      coalesce(s.current_quantity, 0) - coalesce(exp.expired_quantity, 0),
      0
    ),
    exp.earliest_expiry_date,
    p.low_stock_threshold
  from public.products as p
  left join public.stock_levels as s
    on s.product_id = p.id
  left join lateral private.batch_stock_summary(p.id) as exp on true
  where p.active and p.is_sellable
  order by p.name, p.id;
end;
$$;

revoke all on function public.dealer_catalog_for(uuid) from public;
grant execute on function public.dealer_catalog_for(uuid) to authenticated;

comment on function public.dealer_catalog_for(uuid) is
  'The sellable catalogue priced for a named dealer: the same rows dealer_catalog returns, priced the way this dealer is actually charged. Callable by the dealer for themselves, a rep for a dealer mapped to them, and an admin for any active dealer.';
