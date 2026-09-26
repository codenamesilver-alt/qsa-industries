-- Record the opening balances the demo dataset implied but never wrote down.
--
-- The seed migrations set stock_levels to hand-picked numbers and then wrote a
-- movement history around them. The result is that eight of eleven products
-- could not be reconciled against their own ledger: LAYER-01 carried a level of
-- 1100 against a movement total of -100, a 1200 opening balance that existed
-- only in a hand-edited number, and RAW-MAIZE was 6000 adrift the same way.
--
-- Now that stock_movements_apply_level treats a movement as a signed effect on
-- a level, "level equals the signed sum of its movements" is an invariant worth
-- holding, and db:audit checks it for every product. Recording the gap as an
-- explicit opening movement makes the ledger explain the balance instead of the
-- balance being a number someone typed.
--
-- This inserts history only. No level changes, so the demo stock figures and
-- every dataset assertion are unaffected -- it only makes them explainable.
--
-- Depends on 20260925092600_stock_movement_opening_balance_source.sql, which adds
-- the 'opening_balance' enum value in its own transaction.
do $$
declare
  r record;
begin
  -- A negative gap would mean the level sits below the movements already
  -- recorded against it, which no opening balance can explain. Refuse rather
  -- than invent an 'out' opening movement to paper over it.
  if exists (
    select 1
    from (
      select coalesce(sl.current_quantity, 0)
               - coalesce(mv.movement_sum, 0) as gap
      from public.products p
      left join public.stock_levels sl on sl.product_id = p.id
      left join lateral (
        select sum(case m.movement_type when 'in' then m.quantity else -m.quantity end) as movement_sum
        from public.stock_movements m
        where m.product_id = p.id
      ) mv on true
    ) gaps
    where gap < 0
  ) then
    raise exception
      'cannot backfill opening balances: at least one product level is below its movement total, so its opening balance would be negative';
  end if;

  -- The trigger would apply each opening movement to the level a second time,
  -- which is exactly the arithmetic this backfill exists to avoid.
  alter table public.stock_movements disable trigger stock_movements_apply_level;

  for r in
    select p.id,
           p.sku,
           coalesce(sl.current_quantity, 0) - coalesce(mv.movement_sum, 0) as gap,
           coalesce(mv.first_movement, timestamptz '2026-08-01 00:00:00+05:30')
             - interval '1 day' as opened_at
    from public.products p
    left join public.stock_levels sl on sl.product_id = p.id
    left join lateral (
      select sum(case m.movement_type when 'in' then m.quantity else -m.quantity end) as movement_sum,
             min(m.created_at) as first_movement
      from public.stock_movements m
      where m.product_id = p.id
    ) mv on true
  loop
    if r.gap <> 0 then
      insert into public.stock_movements (
        product_id,
        quantity,
        movement_type,
        source,
        reason,
        created_at
      )
      values (
        r.id,
        r.gap,
        'in',
        'opening_balance',
        'Opening balance carried into the ledger for ' || r.sku,
        r.opened_at
      );
    end if;
  end loop;

  alter table public.stock_movements enable trigger stock_movements_apply_level;
end;
$$;

-- Fail the migration rather than leave a half-reconciled ledger behind.
do $$
begin
  if exists (
    select 1
    from (
      select coalesce(sl.current_quantity, 0)
               - coalesce(mv.movement_sum, 0) as gap
      from public.products p
      left join public.stock_levels sl on sl.product_id = p.id
      left join lateral (
        select sum(case m.movement_type when 'in' then m.quantity else -m.quantity end) as movement_sum
        from public.stock_movements m
        where m.product_id = p.id
      ) mv on true
    ) gaps
    where gap <> 0
  ) then
    raise exception 'opening balance backfill left unreconciled products behind';
  end if;
end;
$$;
