begin;
select plan(14);

create temporary table production_test_ids (
  passed_id uuid,
  failed_id uuid
);
grant insert, select on production_test_ids to authenticated;

-- Ambient stock for the two products this suite moves, so the assertions below
-- test production behaviour (deltas) instead of the day-one seed numbers.
create temporary table production_baseline (
  product_id uuid primary key,
  qty numeric
);
grant insert, select on production_baseline to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into production_baseline (product_id, qty)
select product_id, current_quantity
from public.stock_levels
where product_id in (
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000006'
);

select is(
  (select count(*) from production_baseline),
  2::bigint,
  'production suite has a stock baseline for both products'
);

select throws_ok(
  $$select public.create_production_run(
    '30000000-0000-4000-8000-000000000001',
    10,
    'morning',
    current_date,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
    'failed',
    null
  )$$,
  'P0001',
  null,
  'failed production requires notes'
);

select throws_ok(
  $$select public.create_production_run(
    '30000000-0000-4000-8000-000000000001',
    10,
    'morning',
    current_date,
    '[]'::jsonb,
    'passed',
    'Missing materials'
  )$$,
  'P0001',
  null,
  'production requires at least one material'
);

select throws_ok(
  $$select public.create_production_run(
    '30000000-0000-4000-8000-000000000001',
    'NaN'::numeric,
    'morning',
    current_date,
    '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
    'passed',
    'Invalid output'
  )$$,
  'P0001',
  null,
  'production rejects NaN output'
);

insert into production_test_ids (passed_id)
select id
from public.create_production_run(
  '30000000-0000-4000-8000-000000000001',
  10,
  'morning',
  current_date,
  '[
    {"product_id":"30000000-0000-4000-8000-000000000006","quantity":1},
    {"product_id":"30000000-0000-4000-8000-000000000006","quantity":2}
  ]'::jsonb,
  'passed',
  'Passed test run'
);

select ok(
  (select passed_id from production_test_ids where passed_id is not null) is not null,
  'passed production run is created'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty + 10 from production_baseline where product_id = '30000000-0000-4000-8000-000000000001'),
  'passed production increases finished-goods stock'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000006'),
  (select qty - 3 from production_baseline where product_id = '30000000-0000-4000-8000-000000000006'),
  'duplicate raw-material lines aggregate consumption'
);

select is(
  (select count(*) from public.stock_movements where reference_id = (select passed_id from production_test_ids where passed_id is not null) and reason = 'Production material consumption'),
  1::bigint,
  'duplicate raw-material lines create one movement'
);

select is(
  (select quantity from public.stock_movements where reference_id = (select passed_id from production_test_ids where passed_id is not null) and reason = 'Production material consumption'),
  3::numeric,
  'aggregated material quantity reaches stock ledger'
);

insert into production_test_ids (failed_id)
select id
from public.create_production_run(
  '30000000-0000-4000-8000-000000000001',
  5,
  'evening',
  current_date,
  '[{"product_id":"30000000-0000-4000-8000-000000000006","quantity":1}]'::jsonb,
  'failed',
  'Failed test run'
);

select ok(
  (select failed_id from production_test_ids where failed_id is not null) is not null,
  'failed production run is created'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty + 10 from production_baseline where product_id = '30000000-0000-4000-8000-000000000001'),
  'failed production does not increase finished-goods stock'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000006'),
  -- baseline minus the 3 units the passed run consumed and the 1 the failed run consumed
  (select qty - 4 from production_baseline where product_id = '30000000-0000-4000-8000-000000000006'),
  'failed production still consumes raw material'
);

select is(
  (select count(*) from public.stock_movements where reference_id = (select failed_id from production_test_ids where failed_id is not null) and reason = 'Production output'),
  0::bigint,
  'failed production creates no output movement'
);

select throws_ok(
  $$update public.production_runs
  set qc_status = 'failed', qc_notes = 'Late failure'
  where id = (select passed_id from production_test_ids where passed_id is not null)$$,
  'P0001',
  null,
  'finalized QC status cannot change'
);

select * from finish();
rollback;
