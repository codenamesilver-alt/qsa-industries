begin;
select plan(26);

-- Place of supply decides whether an invoice carries IGST or a CGST/SGST split,
-- and it is decided by the state of the supplying office. That office is
-- registered in Haryana, which the finance settings now record.
--
-- The seeded dealers are all outside Haryana, so every seeded invoice is an
-- inter-state supply. The intra-state branch therefore has no data to prove it
-- still works, and a rule that has only ever been exercised one way is a rule
-- that quietly rots. Both branches are built here from the same order, by moving
-- the dealer between Haryana and Maharashtra, so the only variable is the state.

create temporary table pos_case (
  label text primary key,
  dealer_state text,
  cgst numeric,
  sgst numeric,
  igst numeric,
  recorded_company_state text,
  total numeric,
  taxable numeric
);
grant insert, select on pos_case to authenticated;

create temporary table pos_invoice (label text primary key, invoice_id uuid);
grant insert, select on pos_invoice to authenticated;

-- Order ids are captured by set difference rather than by ordering. now() is fixed
-- for the whole transaction, so the two orders this suite creates share a
-- created_at, and "order by created_at desc limit 1" cannot tell them apart. The
-- new order is simply the one that was not there before.
create temporary table pos_before (order_id uuid primary key);
grant insert, select, delete on pos_before to authenticated;

create temporary table pos_order (label text primary key, order_id uuid);
grant insert, select on pos_order to authenticated;

insert into pos_before (order_id) select id from public.orders;

select is(
  (select company_state from public.finance_settings where id = true),
  'Haryana'::text,
  'the supplying office state is recorded as Haryana'
);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '19300000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dealer.placeofsupply@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Place Of Supply Dealer"}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
);

update public.users
set dealer_id = '20000000-0000-4000-8000-000000000001'
where id = '19300000-0000-4000-8000-000000000001';

-- One order per branch. The order is priced from the dealer's catalogue, which
-- does not depend on the dealer's state, so the same dealer and product can be
-- reused and only the state changes between the two cases.
set local role authenticated;
set local request.jwt.claim.sub = '19300000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":5}]'::jsonb
  )),
  'pending'::public.order_status,
  'place of supply order is created pending'
);

insert into pos_order (label, order_id)
select 'inter', o.id
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from pos_before b where b.order_id = o.id)
  and not exists (select 1 from pos_order p where p.order_id = o.id);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select status from public.approve_order(
    (select order_id from pos_order where label = 'inter'),
    null,
    false
  )),
  'approved'::public.order_status,
  'the order is approved'
);

select is(
  (select status from public.dispatch_order(
    (select order_id from pos_order where label = 'inter'),
    current_date,
    'Place of supply test dispatch'
  )),
  'dispatched'::public.order_status,
  'the order is dispatched'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select lives_ok(
  $$select public.generate_invoice(
    (select order_id from pos_order where label = 'inter')
  )$$,
  'the inter-state case generates an invoice'
);

insert into pos_invoice (label, invoice_id)
select 'inter', i.id
from public.invoices i
join pos_order o on o.order_id = i.order_id
where o.label = 'inter';

insert into pos_case (label, dealer_state, cgst, sgst, igst, recorded_company_state, total, taxable)
select
  'inter',
  (select state from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  i.cgst_amount,
  i.sgst_amount,
  i.igst_amount,
  i.company_state,
  i.total_amount,
  i.taxable_amount
from public.invoices i
join pos_invoice p on p.invoice_id = i.id
where p.label = 'inter';

select is(
  (select cgst from pos_case where label = 'inter'),
  0::numeric,
  'a dealer outside Haryana is charged no CGST'
);

select is(
  (select sgst from pos_case where label = 'inter'),
  0::numeric,
  'a dealer outside Haryana is charged no SGST'
);

select ok(
  (select igst > 0 from pos_case where label = 'inter'),
  'a dealer outside Haryana is charged IGST'
);

select ok(
  (select round(taxable * 0.18, 2) = round(igst, 2) from pos_case where label = 'inter'),
  'the IGST equals the taxable value at the configured rate'
);

select is(
  (select recorded_company_state from pos_case where label = 'inter'),
  'Haryana'::text,
  'the invoice records the supplying office state it was priced under'
);

select is(
  (select round(taxable + cgst + sgst + igst, 2) from pos_case where label = 'inter'),
  (select round(total, 2) from pos_case where label = 'inter'),
  'taxable plus IGST reconciles to the invoice total'
);

-- Now the intra-state branch: the dealer sits in Haryana, where the office is.
update public.dealers
set state = 'Haryana'
where id = '20000000-0000-4000-8000-000000000001';

set local request.jwt.claim.sub = '19300000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":5}]'::jsonb
  )),
  'pending'::public.order_status,
  'the intra-state order is created pending'
);

insert into pos_order (label, order_id)
select 'intra', o.id
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from pos_before b where b.order_id = o.id)
  and not exists (select 1 from pos_order p where p.order_id = o.id);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select status from public.approve_order(
    (select order_id from pos_order where label = 'intra'),
    null,
    false
  )),
  'approved'::public.order_status,
  'the intra-state order is approved'
);

select is(
  (select status from public.dispatch_order(
    (select order_id from pos_order where label = 'intra'),
    current_date,
    'Place of supply test dispatch'
  )),
  'dispatched'::public.order_status,
  'the intra-state order is dispatched'
);

set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select lives_ok(
  $$select public.generate_invoice(
    (select order_id from pos_order where label = 'intra')
  )$$,
  'the intra-state case generates an invoice'
);

insert into pos_invoice (label, invoice_id)
select 'intra', i.id
from public.invoices i
join pos_order o on o.order_id = i.order_id
where o.label = 'intra';

insert into pos_case (label, dealer_state, cgst, sgst, igst, recorded_company_state, total, taxable)
select
  'intra',
  (select state from public.dealers where id = '20000000-0000-4000-8000-000000000001'),
  i.cgst_amount,
  i.sgst_amount,
  i.igst_amount,
  i.company_state,
  i.total_amount,
  i.taxable_amount
from public.invoices i
join pos_invoice p on p.invoice_id = i.id
where p.label = 'intra';

select is(
  (select igst from pos_case where label = 'intra'),
  0::numeric,
  'a dealer in Haryana is charged no IGST'
);

select ok(
  (select cgst > 0 from pos_case where label = 'intra'),
  'a dealer in Haryana is charged CGST'
);

select is(
  (select cgst from pos_case where label = 'intra'),
  (select sgst from pos_case where label = 'intra'),
  'the Haryana split is even between CGST and SGST'
);

select ok(
  (select round(taxable * 0.09, 2) = round(cgst, 2) from pos_case where label = 'intra'),
  'each half of the split is half the tax at the configured rate'
);

select ok(
  (select round(total, 2) = (select round(total, 2) from pos_case where label = 'intra') from pos_case where label = 'inter'),
  'both branches are compared on the same order value'
);

select is(
  (select round(taxable + cgst + sgst + igst, 2) from pos_case where label = 'intra'),
  (select round(total, 2) from pos_case where label = 'intra'),
  'taxable plus CGST and SGST reconciles to the invoice total'
);

-- The review worklist. The inter invoice was written with Haryana recorded, so it
-- is correct and must not be listed. The seeded invoices were written while the
-- setting was blank, and every seeded dealer is outside Haryana, so they are listed.
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select ok(
  (select not exists (
     select 1
       from public.finance_place_of_supply_review r
       join pos_invoice p on p.invoice_id = r.id
      where p.label in ('inter', 'intra')
  )),
  'a correctly split invoice is not listed for review'
);

select ok(
  (select count(*) > 0 from public.finance_place_of_supply_review),
  'invoices issued while the state was unset are listed for review'
);

select ok(
  (select bool_and(igst_amount = 0 and cgst_amount > 0 and sgst_amount > 0) from public.finance_place_of_supply_review),
  'every listed invoice was raised with the intra-state split'
);

-- security_invoker, so the worklist honours the invoice policies rather than
-- bypassing them. A dealer sees only their own, and cannot use it to enumerate
-- every other dealer's tax position.
set local request.jwt.claim.sub = '19300000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.finance_place_of_supply_review),
  (select count(*) from public.finance_place_of_supply_review r
     where r.dealer_id = '20000000-0000-4000-8000-000000000001'),
  'a dealer sees only their own invoices in the review worklist'
);

select ok(
  (select count(*) = 0 from public.finance_place_of_supply_review),
  'the dealer raised no invoice under the old default, so the worklist is empty for them'
);

select * from finish();
rollback;
