begin;
select plan(16);

-- Rows this suite creates, so the aggregate assertions below are scoped to the
-- payment flow under test instead of every row the dev demo dataset left behind.
create temporary table payment_test_ids (
  invoice_id uuid,
  invoice_total numeric,
  advance_id uuid
);
grant insert, select on payment_test_ids to authenticated;

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
  '19200000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dealer.payment@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Payment Test Dealer"}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
);

update public.users
set dealer_id = '20000000-0000-4000-8000-000000000001'
where id = '19200000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '19200000-0000-4000-8000-000000000001';

select is(
  (select status from public.create_dealer_order(
    '[{"product_id":"30000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb
  )),
  'pending'::public.order_status,
  'payment test creates a pending order'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  (select status from public.approve_order(
    (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
    null,
    false
  )),
  'approved'::public.order_status,
  'sales manager approves the payment test order'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select status from public.dispatch_order(
    (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1),
    current_date,
    'Payment test dispatch'
  )),
  'dispatched'::public.order_status,
  'admin dispatches the payment test order'
);

insert into payment_test_ids (invoice_id, invoice_total)
select id, total_amount
from public.generate_invoice(
  (select id from public.orders where dealer_id = '20000000-0000-4000-8000-000000000001' order by created_at desc limit 1)
);

select ok(
  (select invoice_id from payment_test_ids where invoice_id is not null) is not null,
  'dispatched order receives an invoice'
);

insert into payment_test_ids (advance_id)
select id
from public.record_dealer_payment(
  '20000000-0000-4000-8000-000000000001',
  20,
  current_date,
  'bank_transfer',
  'Advance test receipt'
);

select ok(
  (select advance_id from payment_test_ids where advance_id is not null) is not null,
  'finance records an account advance'
);

select ok(
  (select id from public.record_invoice_payment(
    (select id from public.invoices order by created_at desc limit 1),
    10,
    current_date,
    'bank_transfer',
    'Invoice allocation from advance'
  )) is not null,
  'invoice payment consumes dealer advance'
);

select is(
  (
    select paid_amount
    from public.dealer_ledger
    where invoice_id = (select invoice_id from payment_test_ids where invoice_id is not null)
  ),
  10::numeric,
  'invoice ledger records allocated advance'
);

select is(
  (
    select coalesce(sum(balance.unallocated), 0)
    from (
      select p.amount - coalesce(sum(pa.amount), 0) as unallocated
      from public.payments as p
      left join public.payment_allocations as pa on pa.payment_id = p.id
      where p.id = (select advance_id from payment_test_ids where advance_id is not null)
      group by p.id, p.amount
    ) as balance
  ),
  10::numeric,
  'advance retains only unallocated balance'
);

select ok(
  (select id from public.record_invoice_payment(
    (select invoice_id from payment_test_ids where invoice_id is not null),
    (select invoice_total - 10 from payment_test_ids where invoice_total is not null),
    current_date,
    'bank_transfer',
    'Remaining invoice settlement'
  )) is not null,
  'remaining invoice settlement succeeds'
);

select is(
  (
    select sum(pa.amount)
    from public.payment_allocations as pa
    where pa.invoice_id = (select invoice_id from payment_test_ids where invoice_id is not null)
  ),
  (select invoice_total from payment_test_ids where invoice_total is not null),
  'payment allocations equal invoice total'
);

select is(
  (
    select outstanding_amount
    from public.dealer_ledger
    where invoice_id = (select invoice_id from payment_test_ids where invoice_id is not null)
  ),
  0::numeric,
  'settled invoice has zero ledger balance'
);

select is(
  (
    select sum(p.amount)
    from public.payments as p
    join public.payment_allocations as pa on pa.payment_id = p.id
    where pa.invoice_id = (select invoice_id from payment_test_ids where invoice_id is not null)
  ),
  (select invoice_total from payment_test_ids where invoice_total is not null),
  'receipts equal invoice total after advance allocation'
);

select throws_ok(
  $$select public.record_invoice_payment(
    (select invoice_id from payment_test_ids where invoice_id is not null),
    1,
    current_date,
    'bank_transfer',
    'Overpayment test'
  )$$,
  'P0001',
  null,
  'settled invoice rejects another payment'
);

select is(
  (select outstanding_invoices from public.dealer_credit_summary('20000000-0000-4000-8000-000000000001')),
  0::numeric,
  'dealer credit summary reaches zero after settlement'
);

select ok(
  (select id from public.record_dealer_payment(
    '20000000-0000-4000-8000-000000000001',
    5,
    current_date,
    'bank_transfer',
    'Settled invoice advance test'
  )) is not null,
  'dealer advance can exist after invoice settlement'
);

select throws_ok(
  $$select public.record_invoice_payment(
    (select invoice_id from payment_test_ids where invoice_id is not null),
    1,
    current_date,
    'bank_transfer',
    'Settled invoice advance misuse'
  )$$,
  'P0001',
  null,
  'settled invoice cannot mint another advance through invoice payment'
);

select * from finish();
rollback;
