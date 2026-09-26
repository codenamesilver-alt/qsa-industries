begin;
select plan(5);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- Capture the ambient dataset state so the assertions below test inventory
-- BEHAVIOUR (deltas) rather than the day-one seed numbers, which the dev demo
-- dataset legitimately changes.
create temporary table inventory_baseline as
select
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001') as qty,
  (select count(*) from public.stock_movements where product_id = '30000000-0000-4000-8000-000000000001' and source = 'adjustment') as adjustments;

select ok(
  (select qty from inventory_baseline) > 0,
  'stage 3 seeds finished goods stock'
);

select is(
  (select source from public.create_stock_adjustment(
    '30000000-0000-4000-8000-000000000001',
    5,
    'in',
    'Cycle count'
  )),
  'adjustment'::public.stock_movement_source,
  'inventory adjustment creates an adjustment movement'
);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty + 5 from inventory_baseline),
  'stock level applies the adjustment'
);

select is(
  (select count(*) from public.stock_movements where product_id = '30000000-0000-4000-8000-000000000001' and source = 'adjustment'),
  (select adjustments + 1 from inventory_baseline),
  'stock movement is recorded once'
);

select throws_ok(
  $$select public.create_stock_adjustment(
    '30000000-0000-4000-8000-000000000001',
    999999,
    'out',
    'Invalid test adjustment'
  )$$,
  'P0001',
  null,
  'stock-out cannot exceed available quantity'
);

select * from finish();
rollback;
