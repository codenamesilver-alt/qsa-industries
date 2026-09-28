begin;
select plan(133);

-- Tests for the two 20260927 migrations: admin master data, and delivery status.
--
-- Conventions follow the earlier suites: everything runs in a transaction that is
-- rolled back, ambient dataset state is captured rather than assumed, and every
-- permission is checked on its refusing side as well as its allowing side.
--
-- Fixed identifiers, all from migrations, identical live and on a from-scratch
-- replay:
--   admin              10000000-...-0001
--   sales_director     10000000-...-0002   (Nadia)
--   sales_manager      10000000-...-0003   (Imran) and 0004 (Meera)
--   sales_rep Ravi     10000000-...-0005   (reports to 0003)
--   sales_rep Vikram   10000000-...-0007   (reports to 0004, and is Coastal's rep)
--   dealer Coastal     4637f04f-...
--   finance            22145f21-...
--   inventory_manager  6a251aaf-...
--   logistics          890e8dd2-...
--
-- Two things about that list are worth stating, because both were got wrong once.
-- The seed has no user for a sales director's own login, and it has exactly one
-- dealer login, so every dealer-visibility assertion below runs as Coastal. And
-- logistics is not in can_view_dealer, which the delivery board had to work around
-- rather than assume.

create temporary table admin_ids (
  product_id uuid,
  dealer_id uuid,
  price_id uuid,
  order_id uuid,
  own_dealer_id uuid
);
grant insert, select, update on admin_ids to authenticated;

-- The suite fills this row in from the objects it creates, and reads the ids back
-- out of it. It has to exist before the first update: an update against an empty
-- table matches no rows and silently leaves every id null, which then surfaces
-- somewhere else entirely as a lookup against a null key.
insert into admin_ids default values;

-- ===========================================================================
-- A. The catalogue belongs to the admin
-- ===========================================================================

-- A rep, a manager, finance, the inventory manager, logistics and a dealer all
-- read the catalogue. None of them may write it. Inventory manager first, because
-- it is the role a person would most expect to be able to add a product and
-- cannot.
set local role authenticated;
set local request.jwt.claim.sub = '6a251aaf-5609-4b83-a04c-282929b6197b';

select ok(
  (select count(*) > 0 from public.products),
  'the inventory manager can read the catalogue'
);

select throws_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe', 'Poultry Feed', 'kg', 10, '4820', null, 0, true, true
  )$$,
  'Only an admin can change the product catalogue',
  'the inventory manager cannot add a product'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe', 'Poultry Feed', 'kg', 10, '4820'
  )$$,
  'Only an admin can change the product catalogue',
  'finance cannot reprice the catalogue'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe', 'Poultry Feed', 'kg', 10, '4820'
  )$$,
  'Only an admin can change the product catalogue',
  'a sales rep cannot add a product'
);

set local role anon;
select throws_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe', 'Poultry Feed', 'kg', 10, '4820'
  )$$,
  null,
  'anonymous cannot call the catalogue writer at all'
);
set local role authenticated;

-- The admin can.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe Feed', 'Poultry Feed', 'kg', 41.5, '4820', null, 12, true, true
  )$$,
  'an admin can add a product'
);

update admin_ids set product_id = (
  select id from public.products where sku = 'QSA-PROBE-01'
);

select is(
  (select price from public.products where id = (select product_id from admin_ids)),
  41.5::numeric,
  'the price the admin sent is the price stored'
);

select is(
  (select hsn_code from public.products where id = (select product_id from admin_ids)),
  '4820',
  'the HSN code is stored as sent'
);

select is(
  (select low_stock_threshold from public.products where id = (select product_id from admin_ids)),
  12::numeric,
  'the low stock threshold is stored as sent'
);

-- lives_ok only proves the statement did not raise. A product that was inserted
-- with every column null would also have passed, so the row is read back field by
-- field above. What lives_ok did not prove is the value, which is asserted here
-- against the row the update path writes.
select is(
  (select count(*)::int from public.products where sku = 'QSA-PROBE-01' and active),
  1,
  'the new product is active'
);

-- The same call with the product id is an edit, not a second product.
select lives_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-01', 'Probe Feed Renamed', 'Poultry Feed', 'kg', 44, '4820',
    (select product_id from admin_ids), 12, true, true
  )$$,
  'an admin can edit a product'
);

select is(
  (select count(*)::int from public.products where sku = 'QSA-PROBE-01'),
  1,
  'an edit does not create a second product'
);

select is(
  (select name from public.products where id = (select product_id from admin_ids)),
  'Probe Feed Renamed',
  'the new name is the stored name'
);

-- ===========================================================================
-- B. Product refusals
-- ===========================================================================

select throws_ok(
  $$select public.admin_upsert_product('  ', 'Probe', 'Poultry Feed', 'kg', 10, '4820')$$,
  'SKU, name, category and unit of measure are all required',
  'a blank SKU is refused'
);

select throws_ok(
  $$select public.admin_upsert_product('QSA-PROBE-02', 'Probe', 'Poultry Feed', 'kg', 10, null)$$,
  'A product needs an HSN code of 4, 6 or 8 digits',
  'a product with no HSN code is refused before invoicing can ever be blocked by it'
);

select throws_ok(
  $$select public.admin_upsert_product('QSA-PROBE-02', 'Probe', 'Poultry Feed', 'kg', -1, '4820')$$,
  'Price must be zero or more',
  'a negative price is refused'
);

select throws_ok(
  $$select public.admin_upsert_product('QSA-PROBE-02', 'Probe', 'Poultry Feed', 'kg', 10, '4820', null, -5)$$,
  'Low stock threshold must be zero or more',
  'a negative low stock threshold is refused'
);

select throws_ok(
  $$select public.admin_upsert_product(
    'QSA-PROBE-02', 'Probe', 'Poultry Feed', 'kg', 10, '4820',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  )$$,
  'No product with that id',
  'editing a product that does not exist is refused, not silently ignored'
);

select throws_ok(
  $$select public.admin_upsert_product('QSA-PROBE-02', 'Probe', 'Poultry Feed', 'kg', 10, '482')$$,
  '23514',
  null,
  'a malformed HSN code is still refused by the table constraint'
);

-- ===========================================================================
-- C. Dealer master data
-- ===========================================================================

select lives_ok(
  $$select public.admin_upsert_dealer(
    'Probe Dealer', 250000, null, 'Probe Contact', '9000000000', 'probe@example.com',
    '1 Probe Street', null, 'Nashik', 'Maharashtra', '422001', null, false,
    'active', 'West', '10000000-0000-4000-8000-000000000005'
  )$$,
  'an admin can add a dealer'
);

update admin_ids set dealer_id = (select id from public.dealers where name = 'Probe Dealer');

select is(
  (select credit_limit from public.dealers where id = (select dealer_id from admin_ids)),
  250000::numeric,
  'the credit limit the admin sent is the limit stored'
);

select is(
  (select region from public.dealers where id = (select dealer_id from admin_ids)),
  'West',
  'the region the admin sent is the region stored'
);

-- The sales rep mapping is the load bearing part: orders.sales_rep_id is not null
-- and is read from it, so a dealer pointed at the wrong kind of user produces
-- orders that cannot be attributed to anyone.
select throws_ok(
  $$select public.admin_upsert_dealer(
    'Bad Rep Dealer', 0, null, null, null, null, null, null, null, null, null, null, false,
    'active', 'West', '10000000-0000-4000-8000-000000000003'
  )$$,
  'A dealer must be mapped to an active sales rep',
  'a dealer cannot be mapped to a sales manager'
);

select throws_ok(
  $$select public.admin_upsert_dealer(
    'No Region Dealer', 0, null, null, null, null, null, null, null, null, null, null, false,
    'active', '   ', null
  )$$,
  'A dealer needs a sales region',
  'a dealer cannot be created without a region, because the region report asserts none is unassigned'
);

select throws_ok(
  $$select public.admin_upsert_dealer(
    'Bad Email Dealer', 0, null, null, null, 'not-an-email', null, null, null, null, null, null, false,
    'active', 'West', null
  )$$,
  'Dealer email does not look like an email address',
  'an obviously malformed dealer email is refused'
);

select throws_ok(
  $$select public.admin_upsert_dealer(
    'Negative Credit Dealer', -1, null, null, null, null, null, null, null, null, null, null, false,
    'active', 'West', null
  )$$,
  'Credit limit must be zero or more',
  'a negative credit limit is refused'
);

select lives_ok(
  $$select public.admin_upsert_dealer(
    'Probe Dealer', 300000, (select dealer_id from admin_ids), 'Probe Contact', '9000000000',
    'probe@example.com', '1 Probe Street', null, 'Nashik', 'Maharashtra', '422001', null, false,
    'active', 'West', '10000000-0000-4000-8000-000000000005'
  )$$,
  'an admin can edit a dealer'
);

select is(
  (select credit_limit from public.dealers where id = (select dealer_id from admin_ids)),
  300000::numeric,
  'the edit changed the stored limit'
);

-- Only one probe dealer exists, so an edit is not a second dealer.
select is(
  (select count(*)::int from public.dealers where name = 'Probe Dealer'),
  1,
  'an edit does not create a second dealer'
);

-- The clearing flag exists because an override of zero and no override at all
-- mean different things, and an editor that cannot clear one is stuck with it.
select lives_ok(
  $$select public.admin_upsert_dealer(
    'Probe Dealer', 300000, (select dealer_id from admin_ids), null, null, null,
    null, null, null, null, null, 40000, false, 'active', 'West', null
  )$$,
  'an admin can set a credit limit override'
);

select is(
  (select credit_limit_override from public.dealers where id = (select dealer_id from admin_ids)),
  40000::numeric,
  'the override is stored'
);

select lives_ok(
  $$select public.admin_upsert_dealer(
    'Probe Dealer', 300000, (select dealer_id from admin_ids), null, null, null,
    null, null, null, null, null, null, true, 'active', 'West', null
  )$$,
  'an admin can clear the credit limit override'
);

select is(
  (select credit_limit_override from public.dealers where id = (select dealer_id from admin_ids)),
  null::numeric,
  'clearing the override stores null rather than zero'
);

-- Non-admins cannot touch dealer master data, including the columns they are
-- allowed to change elsewhere: finance edits credit limits through a different
-- function, and a dealer editing its own name would rewrite the account name on
-- every invoice.
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.admin_upsert_dealer(
    'Finance Renamed Dealer', 0, '20000000-0000-4000-8000-000000000001', null, null, null,
    null, null, null, null, null, null, false, 'active', 'West', null
  )$$,
  'Only an admin can change dealer master data',
  'finance cannot rename a dealer'
);

set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select throws_ok(
  $$select public.admin_upsert_dealer(
    'Dealer Renamed Itself', 0, '20000000-0000-4000-8000-000000000001', null, null, null,
    null, null, null, null, null, null, false, 'active', 'West', null
  )$$,
  'Only an admin can change dealer master data',
  'a dealer cannot rename its own account'
);

-- ===========================================================================
-- D. Price lists
-- ===========================================================================

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 39.25, null,
    (select dealer_id from admin_ids), null, current_date, current_date + 30
  )$$,
  'an admin can add a dealer price'
);

update admin_ids set price_id = (select id from public.price_lists where product_id = (select product_id from admin_ids) and dealer_id = (select dealer_id from admin_ids));

select is(
  (select price from public.price_lists where id = (select price_id from admin_ids)),
  39.25::numeric,
  'the dealer price is stored'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 38, null, (select dealer_id from admin_ids), 'wholesale',
    current_date, current_date + 10
  )$$,
  'A price must belong to either one dealer or one tier, not both and not neither',
  'a price scoped to both a dealer and a tier is refused'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 38, null, null, null, current_date, current_date + 10
  )$$,
  'A price must belong to either one dealer or one tier, not both and not neither',
  'a price scoped to nobody is refused'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 38, null, (select dealer_id from admin_ids), null,
    current_date, current_date + 10
  )$$,
  'That product already has a price for this dealer or tier over those dates',
  'a second overlapping dealer price is refused with a readable message rather than 23P01'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 38, null, 'ffffffff-ffff-4fff-8fff-ffffffffffff', null
  )$$,
  'No dealer with that id',
  'a price for a dealer that does not exist is refused'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 38, null, null, 'wholesale'
  )$$,
  'No product with that id',
  'a price for a product that does not exist is refused'
);

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 38, null, null, 'wholesale', current_date + 10, current_date
  )$$,
  'A price cannot end before it starts',
  'a price period that ends before it starts is refused'
);

-- Non-overlapping periods for the same dealer are fine, which is the accepting
-- side of the same rule the exclusion constraint enforces.
select lives_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 41, null, (select dealer_id from admin_ids), null,
    current_date + 31, current_date + 60
  )$$,
  'a non-overlapping price period for the same dealer is accepted'
);

-- Two rows were written and only one of them is readable, and both facts are worth
-- asserting. price_lists_select_scope hides any row whose window does not cover
-- private.business_date(), so a price that starts in a month is invisible to the
-- browser until its day arrives -- which is the point of the policy, and is also
-- why a count over this table cannot be used to prove a write happened. The
-- catalogue therefore shows the price in force today and nothing else.
select is(
  (select count(*)::int
     from public.price_lists
    where product_id = (select product_id from admin_ids)
      and dealer_id = (select dealer_id from admin_ids)),
  1,
  'only the period covering today is readable, so the browser shows the price in force'
);

select lives_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 40, (select price_id from admin_ids),
    (select dealer_id from admin_ids), null, current_date, current_date + 30
  )$$,
  'an admin can edit a price'
);

select is(
  (select price from public.price_lists where id = (select price_id from admin_ids)),
  40::numeric,
  'the edited price is the stored price'
);

select is(
  (select count(*)::int
     from public.price_lists
    where product_id = (select product_id from admin_ids)
      and dealer_id = (select dealer_id from admin_ids)),
  1,
  'an edit updated the row in place instead of adding a second one'
);

select lives_ok(
  $$select public.admin_delete_price_list((select price_id from admin_ids))$$,
  'an admin can delete a price'
);

select is(
  (select count(*)::int from public.price_lists where id = (select price_id from admin_ids)),
  0,
  'the deleted price is gone'
);

select throws_ok(
  $$select public.admin_delete_price_list((select price_id from admin_ids))$$,
  'No price list entry with that id',
  'deleting a price that does not exist is refused'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_upsert_price_list(
    (select product_id from admin_ids), 1, null, null, 'wholesale'
  )$$,
  'Only an admin can change price lists',
  'a sales rep cannot reprice the catalogue'
);

select throws_ok(
  $$select public.admin_delete_price_list((select price_id from admin_ids))$$,
  'Only an admin can change price lists',
  'a sales rep cannot delete a price'
);

-- ===========================================================================
-- E. Users, roles and the reporting hierarchy
-- ===========================================================================

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- The existing rep already reports to manager 0003. Re-asserting it is the
-- accepting side; every rule below is its refusing side.
select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'an admin can set a rep to report to a manager'
);

select is(
  (select manager_id from public.user_hierarchy where user_id = '10000000-0000-4000-8000-000000000005'),
  '10000000-0000-4000-8000-000000000003'::uuid,
  'the hierarchy row holds the manager the admin chose'
);

select is(
  (select manager_name from public.user_directory where user_id = '10000000-0000-4000-8000-000000000005'),
  (select full_name from public.users where id = '10000000-0000-4000-8000-000000000003'),
  'the directory shows the manager name the screen displays'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'an admin can move a rep to a different manager'
);

select is(
  (select manager_id from public.user_hierarchy where user_id = '10000000-0000-4000-8000-000000000005'),
  '10000000-0000-4000-8000-000000000004'::uuid,
  'the move replaced the manager rather than adding a second hierarchy row'
);

select is(
  (select count(*)::int from public.user_hierarchy where user_id = '10000000-0000-4000-8000-000000000005'),
  1,
  'a rep has exactly one manager row'
);

-- Manager chain.
select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000003', 'Imran Khan', 'sales_manager', true, null,
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'a manager reports to the director'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null, null
  )$$,
  'A sales rep must report to a sales manager',
  'a rep with no manager is refused'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'A sales rep reports to an active sales manager',
  'a rep cannot report to the director'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000005'
  )$$,
  'A sales rep reports to an active sales manager',
  'a rep cannot report to themselves'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000003', 'Imran Khan', 'sales_manager', true, null, null
  )$$,
  'A sales manager must report to the sales director',
  'a manager with no director is refused'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000002', 'Director', 'sales_director', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'Only sales roles report to a manager',
  'a director cannot report to a manager'
);

-- Dealer link rules. A dealer login with no dealer is a login that sees nothing,
-- and a staff login carrying a dealer_id is a login that can read that dealer.
select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'dealer', true, null, null
  )$$,
  'A dealer account must be linked to a dealer',
  'a dealer account with no dealer is refused'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'sales_rep', true,
    '20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004'
  )$$,
  'Only a dealer account can be linked to a dealer',
  'a rep cannot be linked to a dealer'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Nobody', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'No user with that id. Accounts are created out of band; this function changes an account that already exists.',
  'changing a user that does not exist is refused, and the message says where accounts come from'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000001', 'Admin', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'An admin cannot change their own role or suspend themselves. Ask another admin to do it.',
  'an admin cannot demote themselves'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000001', 'Admin', 'admin', false, null, null
  )$$,
  'An admin cannot change their own role or suspend themselves. Ask another admin to do it.',
  'an admin cannot suspend themselves'
);

-- The seed has exactly one active admin, so the last-admin guard is reachable
-- and is the reason the self-edit guards above are not the only defence.
select is(
  (select count(*)::int from public.users where role = 'admin' and is_active),
  1,
  'the dataset really has a single active admin, so the last-admin guard is exercised'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000001', 'Admin', 'finance', true, null, null
  )$$,
  'An admin cannot change their own role or suspend themselves. Ask another admin to do it.',
  'the only admin cannot be demoted, whether by self edit or by the last-admin rule'
);

-- Suspension is the real security control, so it is proved by its effect and not
-- only by its absence of an error: a suspended rep must stop resolving to a role
-- the moment the row is updated.
select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'sales_rep', false, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'an admin can suspend a rep'
);

select is(
  (select is_active from public.users where id = '10000000-0000-4000-8000-000000000007'),
  false,
  'the rep is stored as inactive'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000007';

select ok(
  (select private.current_user_role()) is null,
  'a suspended rep resolves to no role at all, so every role check refuses them'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'Only an admin can change a user, a role or the reporting hierarchy',
  'a suspended rep cannot use the user editor'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- Reinstating is the same call, and the hierarchy rule then has to be re-checked
-- against a manager who is active again.
select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'an admin can reinstate a suspended rep'
);

select is(
  (select is_active from public.users where id = '10000000-0000-4000-8000-000000000007'),
  true,
  'the rep is active again'
);

-- A manager whose reps still point at them cannot be demoted out from under them.
-- Three active reps report to Meera by now: two from the seed, plus Ravi, who was
-- moved across by the move test above. The count is asserted rather than assumed,
-- because the rule is about the accounts actually reporting to them and a test that
-- got the number wrong would still pass for the wrong reason.
select is(
  (select count(*)::int
     from public.user_hierarchy as h
     join public.users as child on child.id = h.user_id
    where h.manager_id = '10000000-0000-4000-8000-000000000004'
      and child.role = 'sales_rep'
      and child.is_active),
  3,
  'three active reps report to this manager, which is what the two refusals below are about'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000004', 'Meera Nair', 'finance', true, null, null
  )$$,
  'Active accounts still report to this one. Move them to another manager first.',
  'a manager cannot be demoted while three reps report to them'
);

select throws_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000004', 'Meera Nair', 'sales_manager', false, null,
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'Active accounts still report to this one. Move them to another manager first.',
  'a manager cannot be suspended while their reps still report to them'
);

select is(
  (select role from public.users where id = '10000000-0000-4000-8000-000000000004'),
  'sales_manager'::public.user_role,
  'the refused call left the manager exactly as it was'
);

-- The accepting side, because a guard that made the operation impossible would be a
-- defect of its own: move all three across, demote, then put the tree back the way
-- the seed had it, since the delivery section below reads it.
select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'the first rep can be moved to the other manager'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'the second rep can be moved as well'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000008', 'Ananya Iyer', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'and the third'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000004', 'Meera Nair', 'finance', true, null, null
  )$$,
  'once nobody reports to them, the manager can be demoted'
);

select is(
  (select count(*)::int from public.user_hierarchy where manager_id = '10000000-0000-4000-8000-000000000004'),
  0,
  'and the demoted manager has no reports left behind'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000004', 'Meera Nair', 'sales_manager', true, null,
    '10000000-0000-4000-8000-000000000002'
  )$$,
  'and can be promoted back to sales manager'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000007', 'Vikram Rao', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'a rep can be moved back'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000008', 'Ananya Iyer', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'and another'
);

select lives_ok(
  $$select public.admin_upsert_user_profile(
    '10000000-0000-4000-8000-000000000005', 'Ravi Menon', 'sales_rep', true, null,
    '10000000-0000-4000-8000-000000000003'
  )$$,
  'Ravi goes back to the manager the seed gave him, which is where he started'
);

select is(
  (select count(*)::int
     from public.user_hierarchy as h
     join public.users as m on m.id = h.manager_id
    where h.user_id in (
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000007',
      '10000000-0000-4000-8000-000000000008'
    )
      and m.role = 'sales_manager'
      and m.is_active),
  3,
  'all three reps report to an active sales manager again, so nothing downstream sees a broken tree'
);

-- ===========================================================================
-- F. Delivery status
-- ===========================================================================

-- One real order, raised by the dealer, approved and dispatched, so delivery is
-- tested on the path it actually runs on rather than on a hand written row.
--
-- The dealer login is Coastal Agri Enterprises, which is the only dealer account
-- the seed creates, and the suite reads its dealer_id out of public.users instead
-- of assuming one: hard coding a dealer that no user is mapped to would have made
-- every visibility assertion below pass for the wrong reason.
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

update admin_ids set own_dealer_id = (
  select dealer_id from public.users where id = '4637f04f-aed6-44bc-82d8-774991079d1d'
);

select ok(
  (select own_dealer_id is not null from admin_ids),
  'the dealer login is mapped to a dealer, so the visibility assertions below are about that dealer'
);

select lives_ok(
  $$select public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
    null,
    null
  )$$,
  'the dealer can place the order that will be delivered'
);

update admin_ids set order_id = (
  select o.id
  from public.orders as o
  where o.dealer_id = (select own_dealer_id from admin_ids)
  order by o.created_at desc
  limit 1
);

select ok(
  (select order_id is not null from admin_ids),
  'the order id was captured, so the assertions below read a real order and not null'
);

select is(
  (select delivery_status from public.orders where id = (select order_id from admin_ids)),
  'awaiting_dispatch'::public.delivery_status,
  'a new order has not been dispatched yet'
);

select is(
  (select delivered_at from public.orders where id = (select order_id from admin_ids)),
  null::timestamptz,
  'a new order has no delivery timestamp'
);

-- The role check comes before the state check, so a dealer is told it may not
-- confirm a delivery at all rather than being told about dispatch state it is not
-- allowed to touch. The two rules are asserted separately below, because a dealer
-- reaching the dispatch message would mean the role check had been skipped.
select throws_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids))$$,
  'Only logistics can confirm a delivery',
  'a dealer cannot confirm its own delivery'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids))$$,
  'Only logistics can confirm a delivery',
  'finance cannot confirm a delivery'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids))$$,
  'Only logistics can confirm a delivery',
  'the sales rep who raised the order cannot confirm it arrived'
);

-- An admin approves, which is the shortest legitimate path from pending to
-- approved. Whether the dealer was inside its credit limit decides whether the
-- order is cleared or escalated, so the status is read back rather than assumed:
-- a test that assumed 'approved' would pass or fail on the dataset's credit
-- position instead of on anything this milestone did.
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.approve_order((select order_id from admin_ids), 'test')$$,
  'the order is approved'
);

select ok(
  (select status in ('approved', 'pending_director_approval')
     from public.orders where id = (select order_id from admin_ids)),
  'the order is either approved or escalated for the director, never left pending'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select lives_ok(
  $$select case
       when (select status from public.orders where id = (select order_id from admin_ids))
         = 'pending_director_approval'
       then public.director_approve_order((select order_id from admin_ids), 'test')
     end$$,
  'a director approval is attempted, and is a no-op when the order was already cleared'
);

select is(
  (select status from public.orders where id = (select order_id from admin_ids)),
  'approved'::public.order_status,
  'the order is approved before anything is dispatched'
);

set local request.jwt.claim.sub = '890e8dd2-9940-4be8-b79c-a43c9de3ce0c';

-- pgTAP compares the whole message here, not a fragment of it, so the expected
-- text carries the order id. A pattern with the id left out would fail against the
-- message this function actually raises and pass for the wrong reason if it ever
-- stopped naming the order.
select throws_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids))$$,
  'Order ' || (select order_id from admin_ids)::text
    || ' has not been dispatched yet, so there is no delivery to confirm',
  'a delivery cannot precede a dispatch, even for logistics'
);

select lives_ok(
  $$select public.dispatch_order((select order_id from admin_ids), current_date, 'probe load')$$,
  'logistics dispatches the order'
);

select is(
  (select delivery_status from public.orders where id = (select order_id from admin_ids)),
  'in_transit'::public.delivery_status,
  'dispatch puts the consignment in transit'
);

select is(
  (select delivered_at from public.orders where id = (select order_id from admin_ids)),
  null::timestamptz,
  'dispatch does not claim a delivery'
);

select is(
  (select count(*)::int
     from public.delivery_board
    where order_id = (select order_id from admin_ids)
      and order_reference = left((select order_id from admin_ids)::text, 8)),
  1,
  'the dispatched order is on the delivery board'
);

-- Still undelivered days later: the board has to be able to say so.
select is(
  (select days_in_transit from public.delivery_board where order_id = (select order_id from admin_ids)),
  0::integer,
  'an order dispatched today is zero days in transit'
);

select lives_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids), 'signed by the gate')$$,
  'logistics confirms the delivery'
);

select is(
  (select delivery_status from public.orders where id = (select order_id from admin_ids)),
  'delivered'::public.delivery_status,
  'the consignment is delivered'
);

select ok(
  (select delivered_at is not null from public.orders where id = (select order_id from admin_ids)),
  'the delivery is timestamped'
);

select is(
  (select delivery_note from public.orders where id = (select order_id from admin_ids)),
  'signed by the gate',
  'the delivery note is stored'
);

select throws_ok(
  $$select public.mark_order_delivered((select order_id from admin_ids))$$,
  'Order ' || (select order_id from admin_ids)::text
    || ' has not been dispatched yet, so there is no delivery to confirm',
  'the same order cannot be confirmed delivered twice, because it is no longer in transit'
);

select throws_ok(
  $$select public.mark_order_delivered('ffffffff-ffff-4fff-8fff-ffffffffffff')$$,
  'Order ffffffff-ffff-4fff-8fff-ffffffffffff was not found',
  'confirming a delivery of an order that does not exist is refused'
);

-- The dealer sees the outcome on its own order: this is the question PRD 4.3
-- asked, and it is the only role that reads it as a customer rather than as staff.
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select is(
  (select delivery_status from public.orders where id = (select order_id from admin_ids)),
  'delivered'::public.delivery_status,
  'the dealer can see that its order was delivered'
);

select ok(
  (select delivered_at is not null from public.orders where id = (select order_id from admin_ids)),
  'the dealer can see when it was delivered'
);

-- And it cannot see anyone else's deliveries.
select is(
  (select count(*)::int
     from public.orders
    where dealer_id is distinct from (select own_dealer_id from admin_ids)),
  0::int,
  'the dealer sees no orders belonging to another account'
);

-- An invoiced order is still a consignment that has to arrive, so the board keeps
-- invoiced rows rather than only dispatched ones.
select is(
  (select count(*)::int
     from public.delivery_board
    where delivery_status = 'delivered'),
  (select count(*)::int
     from public.orders
    where delivery_status = 'delivered'
      and dealer_id = (select own_dealer_id from admin_ids)),
  'the board counts only the deliveries this dealer can see'
);

-- The migration backfilled existing rows rather than leaving them ambiguous.
select is(
  (select count(*)::int
     from public.orders
    where delivery_status = 'in_transit'
      and delivered_at is not null),
  0::int,
  'nothing is in transit with a delivery timestamp'
);

select is(
  (select count(*)::int
     from public.orders
    where delivery_status = 'delivered'
      and (dispatch_date is null or dispatched_at is null)),
  0::int,
  'no delivered order lacks a dispatch record'
);

-- ===========================================================================
-- G. The objects themselves
-- ===========================================================================

-- The design these assertions protect is specific, and it was measured rather
-- than assumed. Before this migration the browser held, on these four tables:
-- whole-table UPDATE on dealers (policed column by column by
-- private.guard_dealer_commercial_columns), UPDATE on products.low_stock_threshold
-- only, UPDATE on users.full_name and users.phone only, and nothing at all on
-- price_lists. What must not become true is an INSERT or a DELETE anywhere, and
-- what must not be granted is the price column: repricing the catalogue is the
-- admin function's job and nothing else.
select is(
  (select count(*)::int
     from pg_class as c
     join pg_namespace as n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relname in ('products', 'dealers', 'price_lists', 'users')
      and (
        has_any_column_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'DELETE')
      )),
  0,
  'no master row is created or destroyed by a table write; creation and deletion go through the checked functions'
);

select is(
  (select has_table_privilege('authenticated', 'public.price_lists'::regclass, 'UPDATE')),
  false,
  'price lists are entirely unwritable from the browser, so the admin price function is the only route'
);

select is(
  (select has_column_privilege('authenticated', 'public.products', 'price', 'UPDATE')),
  false,
  'no signed-in user can reprice a product with a table write'
);

select is(
  (select has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE')),
  false,
  'no signed-in user can change a role with a table write'
);

select is(
  (select has_column_privilege('authenticated', 'public.users', 'dealer_id', 'UPDATE')),
  false,
  'no signed-in user can move an account between dealers with a table write'
);

select is(
  (select has_column_privilege('authenticated', 'public.products', 'low_stock_threshold', 'UPDATE')),
  true,
  'the product threshold column grant from the previous milestone is still the narrow one it was'
);

-- Supabase grants EXECUTE on every new function in the public schema to anon by
-- default, so a function that only an admin can run is revoked from anon by name.
-- This is the assertion that would fail if a future migration added one of these
-- with only the revoke from public.
select is(
  (select count(*)::int
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in (
            'admin_upsert_product', 'admin_upsert_dealer', 'admin_upsert_price_list',
            'admin_delete_price_list', 'admin_upsert_user_profile', 'mark_order_delivered'
          )
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anon holds EXECUTE on none of the six new functions'
);

select is(
  (select count(*)::int
     from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in (
            'admin_upsert_product', 'admin_upsert_dealer', 'admin_upsert_price_list',
            'admin_delete_price_list', 'admin_upsert_user_profile', 'mark_order_delivered'
          )
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  0,
  'authenticated holds EXECUTE on all six, because every screen that needs them is a signed-in screen'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_upsert_product(text, text, text, text, numeric, text, uuid, numeric, boolean, boolean)', 'EXECUTE'),
  'the catalogue writer is executable by a signed-in user'
);

select is(
  (select count(*)::int
     from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders_update_direct'),
  0,
  'orders still has no browser update policy, so delivery can only move through its function'
);

select is(
  (select count(*)::int
     from information_schema.role_routine_grants
    where grantee = 'authenticated'
      and routine_schema = 'public'
      and routine_name = 'mark_order_delivered'
      and privilege_type = 'EXECUTE'),
  1,
  'exactly authenticated may confirm a delivery'
);

select * from finish();
rollback;
