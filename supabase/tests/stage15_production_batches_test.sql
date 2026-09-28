begin;
select plan(27);

-- Production output has to land in a batch for a batch tracked product, or FEFO
-- cannot plan a dispatch against it. Before this, output raised stock_levels,
-- which is what the approval check read, and the order approved cleanly only to
-- fail at the loading bay with "only 0 of unexpired batch stock is available".
--
-- Every case below is rolled back, and the product is a scratch product created
-- here so no seeded stock is disturbed.

create temporary table prod_case (label text primary key, batch_id uuid, batch_code text, expiry_date date);
grant insert, select on prod_case to authenticated;

create temporary table prod_order (label text primary key, order_id uuid);
grant insert, select on prod_order to authenticated;

create temporary table prod_before (order_id uuid primary key);
grant insert, select on prod_before to authenticated;

insert into prod_before (order_id) select id from public.orders;

-- A perishable finished product, shelf life long enough that a run made today is
-- not born expired.
insert into public.products (
  id, sku, name, unit_of_measure, category, is_sellable, active, price, hsn_code, shelf_life_days
)
select
  '31000000-0000-4000-8000-000000000001',
  'QSA-TEST-PERISH-01',
  'Perishable Test Feed',
  'bag',
  'finished_good',
  true,
  true,
  100,
  '23099020',
  90
where not exists (select 1 from public.products where id = '31000000-0000-4000-8000-000000000001');

-- The non perishable counterpart, created here too: authenticated has no insert
-- grant on products, so both fixtures have to exist before the role is set.
insert into public.products (
  id, sku, name, unit_of_measure, category, is_sellable, active, price, hsn_code
)
select
  '31000000-0000-4000-8000-000000000002',
  'QSA-TEST-DRY-01',
  'Non Perishable Test Feed',
  'bag',
  'finished_good',
  true,
  true,
  100,
  '23099020'
where not exists (select 1 from public.products where id = '31000000-0000-4000-8000-000000000002');

select is(
  (select shelf_life_days from public.products where id = '31000000-0000-4000-8000-000000000001'),
  90,
  'the perishable test product carries a shelf life'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19400000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dealer.production@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Production Batch Dealer"}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
)
on conflict (id) do nothing;

update public.users
set dealer_id = '20000000-0000-4000-8000-000000000001'
where id = '19400000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- A production run for a perishable product creates a batch and links the stock
-- movement to it.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'bddaf4a6-c4c0-4637-8369-c3cb7338098d';

select lives_ok(
  $$select public.create_production_run(
    '31000000-0000-4000-8000-000000000001',
    500,
    'morning',
    current_date,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
    'passed'::public.production_qc_status
  )$$,
  'a production run for a perishable product is accepted'
);

select is(
  (select count(*) from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the production run created exactly one batch'
);

select is(
  (select batch_id from public.stock_movements
    where product_id = '31000000-0000-4000-8000-000000000001' and reason = 'Production output'),
  (select id from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  'the production stock movement is linked to that batch'
);

select is(
  (select quantity_received from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  500::numeric,
  'the batch received the produced quantity'
);

select is(
  (select expiry_date from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  (select current_date + 90),
  'the batch expiry is the run date plus the shelf life'
);

select is(
  (select manufacture_date from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  current_date,
  'the batch manufacture date is the run date'
);

select is(
  (select left(batch_code, 4) from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  'PRP-'::text,
  'the batch code is derived from the run'
);

-- ---------------------------------------------------------------------------
-- A dealer order for that product is now shippable, end to end.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = '19400000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"31000000-0000-4000-8000-000000000001","quantity":100}]'::jsonb
  )),
  'pending'::public.order_status,
  'the dealer places an order for the produced product'
);

insert into prod_order (label, order_id)
select 'shippable', o.id
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from prod_before b where b.order_id = o.id)
  and not exists (select 1 from prod_order p where p.order_id = o.id);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.approve_order(
    (select order_id from prod_order where label = 'shippable'), null, false
  )$$,
  'the order is approved, because the output is in a batch and can ship'
);

select is(
  (select status from public.dispatch_order(
    (select order_id from prod_order where label = 'shippable'),
    current_date,
    'Production batch dispatch'
  )),
  'dispatched'::public.order_status,
  'the order dispatches against the production batch'
);

select is(
  (select quantity_issued from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  100::numeric,
  'the batch records the quantity issued against it'
);

-- ---------------------------------------------------------------------------
-- Expired stock is on the books but cannot ship, so approval must refuse.
-- ---------------------------------------------------------------------------
-- product_batches has no direct insert, update or delete grant to authenticated,
-- by design: batches are written only through receive_into_batch and the
-- production trigger. Expiring one on purpose is a data correction, not something
-- the application can do, so the test escalates to the owning role for it, the
-- same way a DBA migration would. reset role returns to the connecting role for
-- the rest of the transaction.
reset role;

-- Both dates move, not just the expiry: product_batches refuses an expiry earlier
-- than its manufacture date, and manufacturing it in the past is the only way to
-- reach a genuinely expired batch.
update public.product_batches
set manufacture_date = current_date - 30,
    expiry_date = current_date - 1
where product_id = '31000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.product_batches
    where product_id = '31000000-0000-4000-8000-000000000001' and expiry_date < current_date),
  1::bigint,
  'the batch has been expired'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- An application role cannot edit a batch, expiry included.
select throws_ok(
  $$update public.product_batches
       set expiry_date = current_date + 30
     where product_id = '31000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'the application cannot rewrite a batch expiry'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '31000000-0000-4000-8000-000000000001'),
  400::numeric,
  'the expired stock is still counted in stock_levels'
);

set local request.jwt.claim.sub = '19400000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"31000000-0000-4000-8000-000000000001","quantity":100}]'::jsonb
  )),
  'pending'::public.order_status,
  'a further order is placed while the only batch has expired'
);

insert into prod_order (label, order_id)
select 'expired', o.id
from public.orders o
where o.dealer_id = '20000000-0000-4000-8000-000000000001'
  and not exists (select 1 from prod_before b where b.order_id = o.id)
  and not exists (select 1 from prod_order p where p.order_id = o.id);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- This is the assertion the old code could not make. stock_levels showed 400, the
-- order asked for 100, so approval passed and logistics discovered the problem.
select throws_ok(
  $$select public.approve_order(
    (select order_id from prod_order where label = 'expired'), null, false
  )$$,
  'P0001',
  null,
  'approval refuses an order that only expired batch stock could fill'
);
select is(
  (select status from public.orders where id = (select order_id from prod_order where label = 'expired')),
  'pending'::public.order_status,
  'the refused order is left pending rather than half approved'
);

-- ---------------------------------------------------------------------------
-- A product with no shelf life and no batches is not batch tracked, and must not
-- be forced into one.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'bddaf4a6-c4c0-4637-8369-c3cb7338098d';

select lives_ok(
  $$select public.create_production_run(
    '31000000-0000-4000-8000-000000000002',
    250,
    'morning',
    current_date,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
    'passed'::public.production_qc_status
  )$$,
  'a production run for a non perishable product is accepted'
);

select is(
  (select count(*) from public.product_batches where product_id = '31000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a non perishable product gets no batch'
);

select is(
  (select batch_id from public.stock_movements
    where product_id = '31000000-0000-4000-8000-000000000002' and reason = 'Production output'),
  null::uuid,
  'its stock movement carries no batch'
);

-- ---------------------------------------------------------------------------
-- A shelf life long enough to have expired already is refused, rather than
-- creating a batch that is born dead.
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'bddaf4a6-c4c0-4637-8369-c3cb7338098d';

select throws_ok(
  $$select public.create_production_run(
    '31000000-0000-4000-8000-000000000001',
    10,
    'morning',
    current_date - 200,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
    'passed'::public.production_qc_status
  )$$,
  'P0001',
  null,
  'a run whose batch would already be expired is refused'
);

select is(
  (select count(*) from public.product_batches where product_id = '31000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the refused run created no extra batch'
);

-- ---------------------------------------------------------------------------
-- A shelf life is a positive number of days. This is a constraint on the product
-- master, so it is checked as the owning role; authenticated cannot write products
-- at all, and mistaking that for the constraint would pass the test for the wrong
-- reason.
-- ---------------------------------------------------------------------------
reset role;

select throws_ok(
  $$update public.products set shelf_life_days = 0 where id = '31000000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  'a zero shelf life is rejected'
);

select throws_ok(
  $$update public.products set shelf_life_days = -5 where id = '31000000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  'a negative shelf life is rejected'
);

select throws_ok(
  $$update public.products set shelf_life_days = 99999 where id = '31000000-0000-4000-8000-000000000002'$$,
  '23514',
  null,
  'an absurd shelf life is rejected'
);

set local role authenticated;

select throws_ok(
  $$update public.products set shelf_life_days = 30 where id = '31000000-0000-4000-8000-000000000002'$$,
  '42501',
  null,
  'the application cannot set a shelf life itself'
);

select * from finish();
rollback;
