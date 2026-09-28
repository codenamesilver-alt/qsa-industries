begin;
select plan(70);

-- Tests for the 20260928 migrations: editing a pending dealer order, pricing a
-- catalogue for a named dealer, and the single pricing function both share.
--
-- The bug these cover was found while building the edit screen, not by reading
-- the PRD. create_dealer_order has always priced a line against the order's own
-- dealer, so a dealer with a negotiated price list is charged its own price from
-- the moment the order is written, and approve_order never re-prices. But
-- dealer_catalog, the view every order screen reads, resolved the price against
-- private.current_dealer_id() -- null for a rep and for an admin -- so it fell
-- through to the standard tier. A rep filling in an order for Green Valley was
-- shown a total the database was never going to charge, and the proxy form even
-- said so on screen: "The dealer's own price list is applied when the order is
-- accepted." It was not. It had already been applied.
--
-- Green Valley (dealer ...0001) carries a live dealer-specific price for
-- QSA-BROILER-01 at 36.90, against a 37.50 tier and a 38.75 catalogue. Coastal
-- (...0003) carries one for the same product at 39.00 that expired yesterday,
-- so it must fall back to the tier. Both branches are asserted here, because a
-- suite that only checked the happy branch would have passed with the original
-- view in place.
--
-- Fixed identifiers, all from migrations:
--   admin              10000000-...-0001  (Arjun)
--   sales_director     10000000-...-0002  (Nadia)
--   sales_manager      10000000-...-0003  (Imran)
--   sales_rep Ravi     10000000-...-0005  (Green Valley)
--   sales_rep Vikram   10000000-...-0007  (Coastal)
--   qc_staff           7c1f0a52-...
--   finance            22145f21-...
--   inventory_manager  6a251aaf-...
--   logistics          890e8dd2-...
--   dealer Coastal     4637f04f-...      (the only dealer login in the seed)
--   dealer Green Valley 20000000-...-0001
--   dealer Coastal      20000000-...-0003
--   product QSA-BROILER-01 30000000-...-0003  (Green Valley 36.90, expired Coastal 39.00)
--   product QSA-LAYER-01   30000000-...-0001  (tier 31.75, no dealer-specific price)
--   product not sellable   30000000-...-0010  (QSA-LAYER-MASH2)
--   product inactive       30000000-...-0011  (QSA-GROWER-02)

create temporary table order_edit_ids (
  green_pending uuid,
  coastal_pending uuid,
  approved_order uuid,
  rejected_order uuid,
  invoiced_order uuid,
  dispatched_order uuid,
  escalated_order uuid
);
grant insert, select, update on order_edit_ids to authenticated;
insert into order_edit_ids default values;

-- ===========================================================================
-- Fixtures
-- ===========================================================================

-- Orders are inserted directly rather than through create_dealer_order, so that
-- the authority checks below are not competing with the create function for the
-- same impersonated session. The order_items trigger still maintains total_amount,
-- and private.assign_order_sales_rep still resolves the rep from the dealer, so
-- the rows are the same shape a real order has.
do $$
declare
  v_green uuid := '20000000-0000-4000-8000-000000000001';
  v_coastal uuid := '20000000-0000-4000-8000-000000000003';
  v_broiler uuid := '30000000-0000-4000-8000-000000000003';
  v_admin uuid := '10000000-0000-4000-8000-000000000001';
  v_order uuid;
begin
  -- Five orders for Green Valley and Coastal in the statuses the status checks
  -- need. A pending order for each dealer, then one of every other status against
  -- Green Valley so the "pending only" rule is checked against real rows rather
  -- than against a status nobody reaches.
  insert into public.orders (dealer_id, created_by, requested_delivery_date)
  values (v_green, v_admin, current_date + 5)
  returning id into v_order;
  update order_edit_ids set green_pending = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 5, 36.90);

  insert into public.orders (dealer_id, created_by)
  values (v_coastal, v_admin)
  returning id into v_order;
  update order_edit_ids set coastal_pending = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 4, 37.50);

  insert into public.orders (dealer_id, created_by, status)
  values (v_green, v_admin, 'approved')
  returning id into v_order;
  update order_edit_ids set approved_order = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 3, 36.90);

  insert into public.orders (dealer_id, created_by, status)
  values (v_green, v_admin, 'rejected')
  returning id into v_order;
  update order_edit_ids set rejected_order = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 2, 36.90);

  insert into public.orders (dealer_id, created_by, status)
  values (v_green, v_admin, 'invoiced')
  returning id into v_order;
  update order_edit_ids set invoiced_order = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 2, 36.90);

  insert into public.orders (dealer_id, created_by, status)
  values (v_green, v_admin, 'dispatched')
  returning id into v_order;
  update order_edit_ids set dispatched_order = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 2, 36.90);

  insert into public.orders (dealer_id, created_by, status)
  values (v_green, v_admin, 'pending_director_approval')
  returning id into v_order;
  update order_edit_ids set escalated_order = v_order;
  insert into public.order_items (order_id, product_id, quantity, unit_price)
  values (v_order, v_broiler, 2, 36.90);
end
$$;

-- ===========================================================================
-- A. One pricing function, and the two entry points that use it
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select ok(
  (select count(*) > 0 from public.dealer_catalog),
  'dealer_catalog still reads for a signed-in user, so the dealer screens did not break'
);

select lives_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'an admin can price any active dealer'
);

-- The whole point of routing both through private.dealer_unit_price: no row can
-- come back at a price the function would not produce.
select is(
  (select count(*)::int
     from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001') as c
    where c.unit_price is distinct from private.dealer_unit_price(c.product_id, '20000000-0000-4000-8000-000000000001')),
  0,
  'every row dealer_catalog_for returns is priced exactly as dealer_unit_price prices it'
);

-- Green Valley's negotiated price must win over the tier it would otherwise get.
-- Data-driven, so a later price change moves the assertion with it rather than
-- breaking on a literal.
select ok(
  (select c.unit_price <> p.price
     from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001') as c
     join public.products as p on p.id = c.product_id
    where c.sku = 'QSA-BROILER-01'),
  'Green Valley is charged its own negotiated price, not the catalogue list price'
);

select ok(
  (select c.unit_price < (select price from public.price_lists
                           where product_id = c.product_id
                             and price_tier = 'standard_dealer')
     from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001') as c
    where c.sku = 'QSA-BROILER-01'),
  'and that negotiated price beats the standard tier it falls back to otherwise'
);

-- Coastal's dealer price for the same product expired yesterday. An expired row
-- must not be honoured, or a lapsed contract keeps billing.
select is(
  (select c.unit_price::numeric(14, 2)
     from public.dealer_catalog_for('20000000-0000-4000-8000-000000000003') as c
    where c.sku = 'QSA-BROILER-01'),
  (select price::numeric(14, 2) from public.price_lists
    where product_id = '30000000-0000-4000-8000-000000000003'
      and price_tier = 'standard_dealer')::numeric(14, 2),
  'an expired dealer price is ignored and the tier price applies'
);

-- Both entry points must offer the same products, or a product that is orderable
-- would be missing from the very screen used to order it.
select is(
  (select count(*)::int from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')),
  (select count(*)::int from public.dealer_catalog),
  'dealer_catalog_for and dealer_catalog list the same sellable products'
);

-- The guard that makes the definer privilege safe. qc_staff is not on
-- can_view_price_list's allow list, so it must get nothing, not the answer.
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select is(
  private.dealer_unit_price('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001'),
  null,
  'dealer_unit_price returns null for a role that may not read that price list'
);

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'qc_staff cannot price a dealer'
);

-- ===========================================================================
-- B. dealer_catalog_for authority
-- ===========================================================================

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select lives_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'a sales rep can price a dealer mapped to them'
);

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000003')$$,
  'P0001',
  'That dealer is not mapped to you',
  'a sales rep cannot price a dealer mapped to somebody else'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'a sales manager has no proxy authority, so no catalogue for any dealer'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'nor does a sales director'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'nor does finance, which can see price lists but does not place orders'
);

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'nor does the inventory manager'
);

set local request.jwt.claim.sub = '890e8dd2-9940-4be8-b79c-a43c9de3ce0c';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Your role cannot view a dealer catalogue',
  'nor does logistics'
);

-- The dealer's own account. Coastal is the only dealer login the seed creates.
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select lives_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000003')$$,
  'a dealer can price its own catalogue'
);

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'Dealers can only view their own catalogue',
  'a dealer cannot price another dealer'
);

-- Shape and liveness of the arguments.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select * from public.dealer_catalog_for(null)$$,
  'P0001',
  'A dealer must be named',
  'a null dealer is refused rather than silently falling back to tier pricing'
);

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000099')$$,
  'P0001',
  'Dealer account is not active',
  'an unknown dealer is refused'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';

select throws_ok(
  $$select * from public.dealer_catalog_for('20000000-0000-4000-8000-000000000001')$$,
  'P0001',
  'You must be signed in to view a dealer catalogue',
  'an unsigned session cannot price a dealer'
);

-- ===========================================================================
-- C. Who may edit an order
-- ===========================================================================

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":6}]'::jsonb,
      current_date + 9
    )$$,
  'an admin can edit a pending order for any dealer'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select lives_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":7}]'::jsonb,
      current_date + 10
    )$$,
  'a sales rep can edit a pending order for a dealer mapped to them'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select coastal_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'That order is not for a dealer mapped to you',
  'a sales rep cannot edit an order for a dealer mapped to somebody else'
);

set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select lives_ok(
  $$select public.edit_dealer_order(
      (select coastal_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":8}]'::jsonb,
      null
    )$$,
  'a dealer can edit its own pending order'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Dealers can only edit their own orders',
  'a dealer cannot edit another dealer''s order'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Your role cannot edit orders',
  'a sales manager can approve an order but cannot rewrite one'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Your role cannot edit orders',
  'nor can a sales director'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Your role cannot edit orders',
  'nor can finance'
);

set local request.jwt.claim.sub = '890e8dd2-9940-4be8-b79c-a43c9de3ce0c';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Your role cannot edit orders',
  'nor can logistics'
);

set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Your role cannot edit orders',
  'nor can the inventory manager'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000000';

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'You must be signed in to edit an order',
  'an unsigned session cannot edit an order'
);

-- Unknown order, checked as a signed-in admin. The same call unsigned fails on the
-- sign-in check first, which is the correct order of refusals but the wrong test of
-- this one.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.edit_dealer_order(
      '20000000-0000-4000-8000-000000000098',
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Order 20000000-0000-4000-8000-000000000098 does not exist',
  'an unknown order is refused rather than created'
);

-- ===========================================================================
-- D. Pending only. An approval is a credit decision on a specific total.
-- ===========================================================================

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.edit_dealer_order(
      (select approved_order from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Only a pending order can be edited',
  'an approved order is closed to edits, because approval priced and credit-checked that total'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select rejected_order from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Only a pending order can be edited',
  'a rejected order stays rejected'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select invoiced_order from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Only a pending order can be edited',
  'an invoiced order cannot be edited behind the ledger'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select dispatched_order from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Only a pending order can be edited',
  'a dispatched order has left the building'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select escalated_order from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Only a pending order can be edited',
  'an escalated order is with the director, and editing it under the director is exactly the wrong thing'
);

-- ===========================================================================
-- E. Price is re-read, never taken from the request
-- ===========================================================================

-- The admin edit above named QSA-LAYER-01. Send a request for the product whose
-- price is most interesting -- Green Valley's negotiated QSA-BROILER-01 at 36.90 --
-- carrying a unit_price of its own, and check what actually got stored.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000003","quantity":5,"unit_price":1.00}]'::jsonb,
      current_date + 12
    )$$,
  'an edit naming a unit_price is accepted, the field simply ignored'
);

select is(
  (select oi.unit_price::numeric(14, 2)
     from public.order_items as oi
    where oi.order_id = (select green_pending from order_edit_ids)
      and oi.product_id = '30000000-0000-4000-8000-000000000003'),
  (select private.dealer_unit_price('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001')::numeric(14, 2)),
  'a unit_price sent in the request is ignored in favour of the dealer price list'
);

-- And that the dealer price really is the negotiated one, not the tier or the list,
-- so the assertion above cannot pass by both sides being equally wrong.
select is(
  (select oi.unit_price::numeric(14, 2)
     from public.order_items as oi
    where oi.order_id = (select green_pending from order_edit_ids)
      and oi.product_id = '30000000-0000-4000-8000-000000000003'),
  (select pl.price::numeric(14, 2)
     from public.price_lists as pl
    where pl.product_id = '30000000-0000-4000-8000-000000000003'
      and pl.dealer_id = '20000000-0000-4000-8000-000000000001'
      and (pl.valid_from is null or pl.valid_from <= private.business_date())
      and (pl.valid_to is null or pl.valid_to >= private.business_date())
    order by pl.valid_from desc nulls last
    limit 1),
  'and the stored price is the dealer list row, not the tier or the catalogue'
);

-- Replaced, not merged. The fixture order carried QSA-BROILER-01; the edit replaced
-- it with QSA-LAYER-01, so the old line must be gone rather than left behind.
select is(
  (select count(*)::int from public.order_items
    where order_id = (select green_pending from order_edit_ids)
      and product_id = '30000000-0000-4000-8000-000000000003'),
  1,
  'the lines the edit did not name are removed, not kept'
);

select is(
  (select count(*)::int from public.order_items
    where order_id = (select green_pending from order_edit_ids)),
  1,
  'an edit leaves exactly the lines it was given'
);

select is(
  (select o.total_amount::numeric(14, 2)
     from public.orders as o
    where o.id = (select green_pending from order_edit_ids)),
  (select round(sum(oi.line_total), 2)
     from public.order_items as oi
    where oi.order_id = (select green_pending from order_edit_ids))::numeric(14, 2),
  'the stored total follows the replaced lines rather than keeping the old figure'
);

-- Two rows for the same product in one request are one line, summed. A UI that
-- double-submitted would otherwise create a duplicate line.
select lives_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":2},
        {"product_id":"30000000-0000-4000-8000-000000000001","quantity":3}]'::jsonb,
      current_date + 11
    )$$,
  'the same product named twice in one edit is accepted'
);

select is(
  (select count(*)::int from public.order_items
    where order_id = (select green_pending from order_edit_ids)),
  1,
  'and lands as a single summed line'
);

select is(
  (select oi.quantity::numeric(14, 2)
     from public.order_items as oi
    where oi.order_id = (select green_pending from order_edit_ids)),
  5::numeric(14, 2),
  'with the two quantities added together'
);

-- ===========================================================================
-- F. Stock, dates and request shape
-- ===========================================================================

-- A line can be raised past what is left even though the original order fitted, so
-- the check has to run again on every edit.
select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      format('[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":%s}]',
             (select (coalesce(current_quantity, 0) + 1000)::int from public.stock_levels
               where product_id = '30000000-0000-4000-8000-000000000001'))::jsonb,
      null
    )$$,
  'P0001',
  'Insufficient stock for product 30000000-0000-4000-8000-000000000001',
  'a quantity beyond the available stock is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      current_date - 1
    )$$,
  'P0001',
  'Requested delivery date cannot be in the past',
  'a requested delivery date in the past is refused'
);

-- A refused edit must leave nothing behind. This is the assertion that would have
-- caught a delete-then-validate ordering.
select is(
  (select count(*)::int from public.order_items
    where order_id = (select green_pending from order_edit_ids)),
  1,
  'the refused edits above left the order exactly as it was'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[]'::jsonb,
      null
    )$$,
  'P0001',
  'At least one order line is required',
  'an empty line list is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '{"not":"an array"}'::jsonb,
      null
    )$$,
  'P0001',
  'Order lines must be a JSON array',
  'a non-array is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      null,
      null
    )$$,
  'P0001',
  'Order lines must be a JSON array',
  'a null line list is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":0}]'::jsonb,
      null
    )$$,
  'P0001',
  'Each order line needs a product and positive quantity',
  'a zero quantity is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":-2}]'::jsonb,
      null
    )$$,
  'P0001',
  'Each order line needs a product and positive quantity',
  'a negative quantity is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":"NaN"}]'::jsonb,
      null
    )$$,
  'P0001',
  'Each order line needs a product and positive quantity',
  'a NaN quantity is refused, which the check constraint on order_items would have caught otherwise'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":null,"quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Each order line needs a product and positive quantity',
  'a line with no product is refused'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000010","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Product 30000000-0000-4000-8000-000000000010 is not available for ordering',
  'a product that is not sellable cannot be added by an edit'
);

select throws_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000011","quantity":1}]'::jsonb,
      null
    )$$,
  'P0001',
  'Product 30000000-0000-4000-8000-000000000011 is not available for ordering',
  'nor can an inactive product'
);

-- Clearing the date is a legitimate correction, so null has to be accepted rather
-- than treated as "no change".
select lives_ok(
  $$select public.edit_dealer_order(
      (select green_pending from order_edit_ids),
      '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":5}]'::jsonb,
      null
    )$$,
  'the requested delivery date can be cleared'
);

select is(
  (select o.requested_delivery_date
     from public.orders as o
    where o.id = (select green_pending from order_edit_ids)),
  null,
  'and the order no longer asks for a date'
);

-- ===========================================================================
-- G. Privileges. A function the browser can only reach through is the control.
-- ===========================================================================

reset role;

select is(
  (select count(*)::int
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('edit_dealer_order', 'dealer_catalog_for')
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon holds EXECUTE on neither new public function'
);

select is(
  (select count(*)::int
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'private'
    where p.proname = 'dealer_unit_price'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon holds no EXECUTE on the pricing function either'
);

select is(
  (select count(*)::int
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('edit_dealer_order', 'dealer_catalog_for')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'authenticated holds EXECUTE on both, because both are signed-in screens'
);

-- The reason the function is safe to grant at all. Without the guard it would be a
-- price-list oracle for any role that is not on the allow list.
select ok(
  has_function_privilege('authenticated', 'private.dealer_unit_price(uuid, uuid)', 'EXECUTE'),
  'the pricing function is executable by a signed-in user, and relies on its own guard'
);

-- The function must be the only way through. If a browser session can update the
-- order header directly, every check above is decoration.
select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname in ('orders_insert_direct', 'orders_update_direct', 'orders_delete_direct')),
  0,
  'orders still has no browser write policy, so an edit can only go through edit_dealer_order'
);

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'order_items'
      and policyname not like '%select%'),
  0,
  'order_items has a read policy and nothing else'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$update public.orders
      set total_amount = 1
    where id = (select green_pending from order_edit_ids)$$,
  '42501',
  null,
  'a signed-in admin cannot write the order total directly'
);

select throws_ok(
  $$insert into public.order_items (order_id, product_id, quantity, unit_price)
    values ((select green_pending from order_edit_ids), '30000000-0000-4000-8000-000000000001', 1, 1)$$,
  '42501',
  null,
  'nor insert a line at a price of their choosing'
);

select throws_ok(
  $$delete from public.order_items
    where order_id = (select green_pending from order_edit_ids)$$,
  '42501',
  null,
  'nor delete the lines behind the function''s back'
);

select * from finish();
rollback;
