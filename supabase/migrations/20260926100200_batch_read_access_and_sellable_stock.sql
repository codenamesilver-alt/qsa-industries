-- Fix: product_batches was unreachable, which quietly broke two views.
--
-- 20260926093800 created public.product_batches but never enabled row level
-- security on it and never granted SELECT to authenticated. Both of the views
-- that read it are declared security_invoker, so they resolve their permissions
-- as the calling role:
--
--   * public.dealer_catalog   -- every dealer order screen
--   * public.expiring_batches -- the expiry report
--
-- With no grant on the underlying table, both raise
-- `permission denied for table product_batches` for every application user. Not
-- for privileged roles, and not for the superuser the migrations run as, which is
-- why the fresh-install check "the expiry batch view exists" passed: it proved
-- the view was created, never that a single authenticated user could read it.
-- Checking that a view exists is not the same as checking that it works.
--
-- The read scope deliberately matches stock_movements_select_scope. A dealer has
-- no business seeing batch codes, expiry dates or warehouse quantities.
--
-- That creates a second problem, and it is the reason this is not just a grant.
-- dealer_catalog exists to subtract expired stock from what a dealer may order.
-- If the batch rows are hidden from dealers by RLS, the lateral that computes
-- the expired quantity returns nothing for them, and the one group of users the
-- rule exists for would be the only group allowed to order expired stock. So the
-- aggregate is computed by a security definer helper, which reads the batches
-- regardless of the caller's policies and returns a number rather than a batch.
-- The dealer learns that 40 units are not sellable, which is exactly the
-- information the order screen needs, and learns nothing about which batch they
-- came from.

-- ---------------------------------------------------------------------------
-- Access control on the batch ledger
-- ---------------------------------------------------------------------------

alter table public.product_batches enable row level security;

drop policy if exists product_batches_select_scope on public.product_batches;

create policy product_batches_select_scope
  on public.product_batches
  for select
  to authenticated
  using (
    private.current_user_role() = any (
      array[
        'admin'::public.user_role,
        'production_manager'::public.user_role,
        'inventory_manager'::public.user_role,
        'logistics'::public.user_role,
        'finance'::public.user_role
      ]
    )
  );

-- No write policy. quantity_received and quantity_issued move only through the
-- stock_movements trigger and receive_into_batch; a client that could set them
-- directly could invent stock that no movement accounts for, and the batch ledger
-- would stop reconciling against the product ledger it is supposed to explain.
revoke all on table public.product_batches from anon, authenticated;
grant select on table public.product_batches to authenticated;

comment on table public.product_batches is
  'Optional batch/lot ledger. Only engaged for products that have batches; other products leave stock_movements.batch_id null. Readable by staff; written only by the stock movement trigger and receive_into_batch.';

-- ---------------------------------------------------------------------------
-- RLS-independent batch aggregates for the catalog
-- ---------------------------------------------------------------------------

create or replace function private.batch_stock_summary(target_product_id uuid)
returns table (
  expired_quantity numeric,
  earliest_expiry_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      sum(
        case
          when b.expiry_date < private.business_date()
            then b.quantity_received - b.quantity_issued
          else 0
        end
      ),
      0
    )::numeric,
    min(
      case
        when b.expiry_date >= private.business_date()
         and b.quantity_received > b.quantity_issued
          then b.expiry_date
      end
    )
  from public.product_batches b
  where b.product_id = target_product_id
$$;

comment on function private.batch_stock_summary(uuid) is
  'Expired and earliest-expiry batch quantities for a product, computed irrespective of the caller''s row level security so the sellable quantity is the same for every role.';

-- Executable by authenticated because dealer_catalog calls it on the way in for
-- every caller, dealers included. It returns aggregates only, never a batch row.
revoke all on function private.batch_stock_summary(uuid) from public;
grant execute on function private.batch_stock_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The catalog, reading batches through the helper
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
left join lateral private.batch_stock_summary(p.id) exp on true
where p.active and p.is_sellable;

grant select on public.dealer_catalog to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges the batch migration left open
-- ---------------------------------------------------------------------------

-- allocate_batches_fefo is the first-expiry-first-out preview the dispatch screen
-- shows, so logistics and admin need to call it. Revoked from public first,
-- because batch codes and expiry dates are not a dealer's business.
revoke all on function private.allocate_batches_fefo(uuid, numeric) from public;
grant execute on function private.allocate_batches_fefo(uuid, numeric) to authenticated;

-- Trigger-only. Reached exclusively through the stock_movements trigger, so no
-- role needs to call them directly.
revoke all on function private.adjust_batch_quantity(uuid, numeric) from public;
revoke all on function private.apply_batch_movement() from public;
