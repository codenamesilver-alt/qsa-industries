-- Make private.dealer_unit_price callable, without opening a price-list leak.
--
-- 20260928093500 revoked the function from public and relied on the view being
-- security_invoker, which was wrong: a SECURITY DEFINER function still needs the
-- caller to hold EXECUTE, so dealer_catalog failed with
--
--   permission denied for function dealer_unit_price
--
-- for every dealer order screen. Granting EXECUTE to authenticated without a guard
-- would be worse than either error. The function is definer-owned, so it reads
-- price_lists without price_lists_select_scope applying: an unguarded grant would
-- let a rep read any dealer's price, including the future-dated rows the policy
-- hides. An inventory manager has no business knowing what a dealer's 2027 contract
-- price is, and "it is a private schema function" is not a control.
--
-- So the grant comes with the guard, using the predicate that already governs this
-- exact question. private.can_view_price_list is what price_lists_select_scope calls,
-- and it answers true for admin, sales_director, sales_manager, sales_rep and finance
-- on any dealer, and for a dealer only on their own record or on tier rows. Routing
-- the resolution through it means the function can never return a price the policy
-- would have refused, and the view keeps working unchanged:
--
--   * a dealer calls the view with current_dealer_id() = their own id, which
--     can_view_price_list accepts
--   * a rep calls the view with current_dealer_id() = null, accepted on the role list
--
-- One deliberate behaviour change, and it is the point of the exercise: a future-dated
-- price now shows in dealer_catalog. Previously the view, running under the policy,
-- could not see those rows and displayed an older price than create_dealer_order
-- charged. The view now shows what the order will actually cost.

create or replace function private.dealer_unit_price(target_product_id uuid, target_dealer_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Same predicate price_lists_select_scope uses, so EXECUTE here cannot read a row
  -- that SELECT on price_lists would have hidden.
  if not private.can_view_price_list(target_dealer_id) then
    return null;
  end if;

  return (
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
    )
  );
end;
$$;

revoke all on function private.dealer_unit_price(uuid, uuid) from public;
grant execute on function private.dealer_unit_price(uuid, uuid) to authenticated;

comment on function private.dealer_unit_price(uuid, uuid) is
  'The price this dealer pays for this product: its own price list first, then the standard_dealer tier, then the catalogue list price. Returns null unless private.can_view_price_list admits the dealer, so the definer privilege behind it grants no more than the price_lists_select_scope policy already does. Shared by dealer_catalog, dealer_catalog_for and the order functions, so a displayed price and a charged price cannot disagree.';
