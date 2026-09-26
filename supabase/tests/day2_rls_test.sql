begin;
select plan(14);

-- Captured while the session is still the table owner, so RLS does not apply and
-- this is the true dealer total. Lets the director assertion below test the
-- policy rather than how many dealers the current dataset happens to contain.
create temporary table dealer_totals as
  select count(*)::bigint as total_dealers from public.dealers;
grant select on dealer_totals to authenticated;

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
  '19000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dealer.one@qsa-demo.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Dealer One"}'::jsonb,
  timezone('utc', now()),
  timezone('utc', now())
);

select is(
  (select role::text from public.users where id = '19000000-0000-4000-8000-000000000001'),
  'dealer',
  'auth signup trigger creates the requested role'
);

update public.users
set dealer_id = '20000000-0000-4000-8000-000000000001'
where id = '19000000-0000-4000-8000-000000000001';

select ok(
  not has_table_privilege('anon', 'public.users', 'select'),
  'anon cannot select users'
);

set local role anon;

select throws_ok(
  $$select * from public.users$$,
  '42501',
  null,
  'anon cannot read users through the data api'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select results_eq(
  $$select email from public.users where id = (select auth.uid())$$,
  array['ravi.menon@qsa-demo.in'],
  'a sales rep can read their own profile'
);

select results_eq(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000001'$$,
  array['Green Valley Poultry Farms'],
  'a sales rep can read their mapped dealer'
);

select is_empty(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000002'$$,
  'a sales rep cannot read another dealer'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select results_eq(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000001'$$,
  array['Green Valley Poultry Farms'],
  'a sales manager can read a mapped rep dealer'
);

select is_empty(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000003'$$,
  'a sales manager cannot read another manager dealer'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.dealers),
  (select total_dealers from dealer_totals),
  'a sales director can read every dealer'
);

set local request.jwt.claim.sub = '19000000-0000-4000-8000-000000000001';

select results_eq(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000001'$$,
  array['Green Valley Poultry Farms'],
  'a dealer can read their own dealer record'
);

select is_empty(
  $$select name from public.dealers where id = '20000000-0000-4000-8000-000000000002'$$,
  'a dealer cannot read another dealer'
);

select results_eq(
  $$update public.dealers set phone = '+91 90000 00000' where id = '20000000-0000-4000-8000-000000000001' returning phone$$,
  array['+91 90000 00000'],
  'a dealer can update their own contact fields'
);

select ok(
  not has_table_privilege('authenticated', 'public.payment_allocations', 'insert'),
  'authenticated users cannot write payment allocations directly'
);

select throws_ok(
  $$insert into public.users (id, full_name, email, role) values (gen_random_uuid(), 'Blocked', 'blocked@example.com', 'sales_rep')$$,
  '42501',
  null,
  'an authenticated user cannot create arbitrary profiles'
);

select * from finish();
rollback;
