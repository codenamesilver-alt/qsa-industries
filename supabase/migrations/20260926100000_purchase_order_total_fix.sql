-- Fix: a purchase order total was always one line behind.
--
-- 20260926093700 recalculated the order total from a BEFORE INSERT trigger on
-- purchase_order_lines. A BEFORE trigger runs before the row is visible to the
-- statement's own snapshot, so the sum it read did not include the line being
-- inserted. Every purchase order therefore reported the total of all its lines
-- except the last one: two lines of 4500.00 and 3100.00 reported 4500.00.
--
-- The line total itself was correct, because that part only writes to NEW and
-- needs no read. Only the order total was wrong, which is the worst possible
-- shape for the bug: the arithmetic on screen looks plausible, so a purchase
-- order for the wrong amount is entirely believable.
--
-- Fix is to split the two jobs. The line total stays a BEFORE trigger, because
-- it only writes NEW. The order total moves to an AFTER trigger, where the row
-- exists and the sum is complete.

drop trigger if exists purchase_order_lines_total on public.purchase_order_lines;
drop trigger if exists purchase_order_lines_total_delete on public.purchase_order_lines;

create or replace function private.set_purchase_order_line_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- No read of the line table, so BEFORE is the right timing here: this value is
  -- written onto the row itself.
  new.line_total := round(new.quantity * new.unit_price, 2);
  return new;
end;
$$;

create or replace function private.recalculate_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_id uuid;
begin
  target_order_id := case when tg_op = 'DELETE' then old.purchase_order_id
                          else new.purchase_order_id
                         end;

  -- AFTER timing, so the inserted, updated or deleted line is already reflected
  -- in the table this sum reads.
  update public.purchase_orders
     set total_amount = coalesce((
           select sum(l.quantity * l.unit_price)
           from public.purchase_order_lines l
           where l.purchase_order_id = target_order_id
         ), 0)
   where id = target_order_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger purchase_order_lines_total
  before insert or update of quantity, unit_price on public.purchase_order_lines
  for each row
  execute function private.set_purchase_order_line_total();

create trigger purchase_order_lines_total_after
  after insert or update of quantity, unit_price or delete on public.purchase_order_lines
  for each row
  execute function private.recalculate_purchase_order_total();

-- Repair anything the old trigger already wrote. On a fresh install there is
-- nothing to repair, which is why this replayed cleanly and only surfaced once
-- the suite checked the arithmetic.
update public.purchase_orders po
   set total_amount = coalesce((
         select sum(l.quantity * l.unit_price)
         from public.purchase_order_lines l
         where l.purchase_order_id = po.id
       ), 0);

update public.purchase_order_lines
   set line_total = round(quantity * unit_price, 2)
 where line_total is distinct from round(quantity * unit_price, 2);
