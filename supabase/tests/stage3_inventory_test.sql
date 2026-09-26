begin;
select plan(12);

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

-- Ledger reversibility. The trigger used to fire on insert only, so a deleted
-- movement left stock_levels understated forever and a rewritten quantity
-- drifted away from the ledger with no complaint. App roles cannot rewrite
-- movements at all, so these run as the table owner: that is who maintenance
-- and the lifecycle cleanup helper are.
reset role;

create temporary table ledger_baseline as
select current_quantity as qty
from public.stock_levels
where product_id = '30000000-0000-4000-8000-000000000001';

-- A known id, because these suites run through node-postgres where psql's
-- \gset and RETURNING-into a variable are not available.
create temporary table ledger_probe as select gen_random_uuid() as id;

insert into public.stock_movements (id, product_id, quantity, movement_type, source, reason)
select id, '30000000-0000-4000-8000-000000000001', 7, 'out', 'adjustment', 'ledger reversibility test'
from ledger_probe;

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty - 7 from ledger_baseline),
  'a movement lowers the level it moved'
);

-- The demo timeline migrations rewrite created_at on live movements, so this
-- case has to stay a no-op or a from-scratch replay would lose stock.
update public.stock_movements
set created_at = created_at - interval '1 day'
where id = (select id from ledger_probe);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty - 7 from ledger_baseline),
  'rewriting a movement timestamp does not move stock'
);

update public.stock_movements
set quantity = 3
where id = (select id from ledger_probe);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty - 3 from ledger_baseline),
  'changing a movement quantity re-applies only the difference'
);

update public.stock_movements
set movement_type = 'in'
where id = (select id from ledger_probe);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty + 3 from ledger_baseline),
  'flipping a movement direction applies the opposite sign'
);

delete from public.stock_movements where id = (select id from ledger_probe);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty from ledger_baseline),
  'deleting a movement restores the level it moved'
);

-- Same again for a receipt, where the reversal runs the other way.
insert into public.stock_movements (id, product_id, quantity, movement_type, source, reason)
select id, '30000000-0000-4000-8000-000000000001', 4, 'in', 'adjustment', 'ledger reversibility test'
from ledger_probe;

delete from public.stock_movements where id = (select id from ledger_probe);

select is(
  (select current_quantity from public.stock_levels where product_id = '30000000-0000-4000-8000-000000000001'),
  (select qty from ledger_baseline),
  'deleting a receipt takes the stock back off the level'
);

set local role authenticated;

select throws_ok(
  $$delete from public.stock_movements where id = '00000000-0000-4000-8000-000000000000'$$,
  '42501',
  null,
  'authenticated cannot delete a stock movement'
);

select * from finish();
rollback;
