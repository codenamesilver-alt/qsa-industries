begin;
select plan(9);

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
  '19100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dealer.workflow@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Workflow Dealer"}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
);

update public.users
set dealer_id = '20000000-0000-4000-8000-000000000001'
where id = '19100000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '19100000-0000-4000-8000-000000000001';

-- Ambient stock for the dispatched product, so the assertion below tests the
-- dispatch delta rather than the day-one seed number.
create temporary table dispatch_baseline as
select current_quantity as qty
from public.stock_levels
where product_id = '30000000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":10}]'::jsonb
  )),
  'pending'::public.order_status,
  'dealer creates a pending order'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  (select status from public.approve_order(
    (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
    null,
    false
  )),
  'approved'::public.order_status,
  'sales manager approves the order'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select status from public.dispatch_order(
    (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
    current_date,
    'Workflow test dispatch'
  )),
  'dispatched'::public.order_status,
  'admin dispatches the approved order'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty - 10 from dispatch_baseline),
  'dispatch reduces finished-goods stock'
);

select is(
  (select count(*) from public.stock_movements where reference_id = (
    select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1
  ) and source = 'sales'),
  1::bigint,
  'dispatch creates one sales stock movement'
);

select is(
  (select count(*) from public.order_events where order_id = (
    select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1
  ) and status = 'dispatched'),
  1::bigint,
  'dispatch status event is recorded once'
);

set local request.jwt.claim.sub = '19100000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1000}]'::jsonb
  )),
  'pending'::public.order_status,
  'dealer can submit an order within available stock'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select ok(
  (select id from public.create_stock_adjustment(
    '30000000-0000-4000-8000-000000000001',
    200,
    'out',
    'Concurrent stock movement test'
  )) is not null,
  'concurrent stock movement is recorded'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.approve_order(
    (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
    null,
    false
  )$$,
  'P0001',
  null,
  'approval rejects an order after stock changed'
);

select * from finish();
rollback;
