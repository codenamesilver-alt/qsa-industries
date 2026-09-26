-- Make the stock movement ledger reversible.
--
-- stock_movements_apply_level was `after insert`, so it maintained stock_levels
-- on the way in and then forgot about the row. Two consequences, both bad:
--
--   * deleting a movement left stock_levels permanently understated, and
--   * rewriting a movement's quantity or direction silently desynced the level
--     from the ledger that is supposed to explain it.
--
-- e2e-cleanup.mjs hit exactly this and had to restore the level by hand, which
-- is a sign the database, not the script, was wrong.
--
-- The fix is to treat a movement as a signed effect on one product: 'in' adds,
-- 'out' subtracts. An insert applies that effect, a delete applies its
-- negation, and an edit applies the difference between the two. stock_levels is
-- then a pure function of the ledger and cannot drift.
--
-- This deliberately does NOT make the ledger append-only. Three migrations
-- rewrite movement timestamps to build a believable demo timeline
-- (20260925092200, 20260925092400), and a rule that rejects updates outright
-- would break a from-scratch replay. Those updates only touch created_at, which
-- nets to zero here and leaves stock alone.
--
-- The deeper question -- whether an ERP should permit history edits at all -- is
-- a policy decision, not a trigger bug. What this migration removes is the
-- possibility of a silent, self-healing-looking desync.

-- Applies one signed delta to one product's level, refusing to take stock below
-- zero. Split out of the trigger so the insert, delete and edit paths cannot
-- drift apart in how they validate.
create or replace function private.adjust_stock_level(
  target_product_id uuid,
  delta numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_unit text;
  available_quantity numeric(14, 2);
begin
  if delta = 0 then
    return;
  end if;

  select p.unit_of_measure
  into product_unit
  from public.products as p
  where p.id = target_product_id;

  if product_unit is null then
    raise exception 'Product % does not exist', target_product_id;
  end if;

  insert into public.stock_levels (product_id, current_quantity, unit)
  values (target_product_id, 0, product_unit)
  on conflict (product_id) do nothing;

  select current_quantity
  into available_quantity
  from public.stock_levels
  where product_id = target_product_id
  for update;

  if delta < 0 and available_quantity < -delta then
    raise exception 'Insufficient stock for product %: available %, requested %',
      target_product_id,
      available_quantity,
      -delta;
  end if;

  update public.stock_levels
  set current_quantity = current_quantity + delta,
      updated_at = now()
  where product_id = target_product_id;
end;
$$;

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_product uuid;
  old_delta numeric(14, 2) := 0;
  new_product uuid;
  new_delta numeric(14, 2) := 0;
begin
  -- Preserved from the original function. Under an after trigger this
  -- assignment cannot reach the stored row, so created_by is in practice only
  -- ever set by the caller. Left as-is rather than quietly changing which rows
  -- carry an actor.
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  if tg_op <> 'INSERT' then
    old_product := old.product_id;
    old_delta := case old.movement_type
      when 'in' then old.quantity
      else -old.quantity
    end;
  end if;

  if tg_op <> 'DELETE' then
    new_product := new.product_id;
    new_delta := case new.movement_type
      when 'in' then new.quantity
      else -new.quantity
    end;
  end if;

  if old_product is not distinct from new_product then
    -- Every insert, every delete, and every edit that keeps the same product.
    -- Applied as one net update rather than a reversal followed by a fresh
    -- movement, so the level is never transiently wrong and the sufficiency
    -- check reads the level this statement actually leaves behind.
    perform private.adjust_stock_level(new_product, new_delta - old_delta);
  else
    -- The edit moved the movement to a different product: unwind the old one,
    -- then apply to the new one.
    perform private.adjust_stock_level(old_product, -old_delta);
    perform private.adjust_stock_level(new_product, new_delta);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movements_apply_level on public.stock_movements;

create trigger stock_movements_apply_level
after insert or update or delete on public.stock_movements
for each row
execute function private.apply_stock_movement();

revoke all on function private.adjust_stock_level(uuid, numeric) from public;
