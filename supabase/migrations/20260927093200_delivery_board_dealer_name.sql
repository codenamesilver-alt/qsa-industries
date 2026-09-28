-- Logistics can read the whole order book, and could not read a single dealer row.
--
-- The delivery board joined public.dealers to label each consignment with the
-- dealer it is going to, and that join returned nothing for logistics. The
-- dealers RLS policy is private.can_view_dealer(id), which grants the whole book
-- to admin, sales_director and finance, and nothing at all to logistics -- while
-- the orders policy has a separate explicit carve-out that does include
-- logistics. So for the one role that has to act on every order in the country,
-- the board was empty: not one row, zero, on every screen, and no error to
-- explain it. A sales manager who drifted outside their subtree would have seen
-- exactly the same thing.
--
-- Widening can_view_dealer would have been the easy fix and the wrong one. It is
-- the gate on the dealer table itself: it decides who can read credit limits,
-- addresses and contact people, and logistics has no business widening that,
-- least of all as a side effect of wanting a name in a list.
--
-- So the board stops joining the dealer table. It asks for one column through a
-- definer function that returns the name and nothing else, and only to a caller
-- who either already sees the whole book or can already see that dealer. The
-- view stays security_invoker, so the orders policy still decides which rows
-- exist; this only stops the label from being the thing that hides them. An
-- unauthenticated caller gets null, and a dealer asking about somebody else's
-- dealer gets null.

create or replace function private.dealer_display_name(target_dealer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.name
  from public.dealers as d
  where d.id = target_dealer_id
    and (
      private.current_user_role() in ('admin', 'logistics', 'finance', 'sales_director')
      or private.can_view_dealer(target_dealer_id)
    )
$$;

comment on function private.dealer_display_name(uuid) is
  'The dealer name, for a screen that already holds the order. Internal book-wide roles and anyone who can view the dealer get the name; everyone else, including anon, gets null. Exists because the dealers table policy hides rows from roles that the orders policy does not, and a board that joins on a hidden table shows nothing rather than showing something.';

revoke all on function private.dealer_display_name(uuid) from public;
revoke all on function private.dealer_display_name(uuid) from anon;

grant execute on function private.dealer_display_name(uuid) to authenticated;

-- Same columns, same order, so this is a replacement and not a drop. dealer_name
-- moves from d.name to the helper, which is the only difference.
create or replace view public.delivery_board
with (security_invoker = true)
as
select
  o.id as order_id,
  left(o.id::text, 8) as order_reference,
  private.dealer_display_name(o.dealer_id) as dealer_name,
  o.sales_rep_id,
  o.status,
  o.delivery_status,
  o.dispatch_date,
  o.delivered_at,
  o.tracking_note,
  o.delivery_note,
  o.total_amount,
  (o.dispatch_date - private.business_date())::integer as days_in_transit
from public.orders as o
where o.delivery_status <> 'awaiting_dispatch'
   or o.status in ('approved', 'dispatched', 'invoiced');

comment on view public.delivery_board is
  'Orders logistics still has to move: everything approved and everything on a vehicle. security_invoker, so the orders policy still applies: a dealer sees their own rows, a rep or manager sees their dealers, logistics and admin see everything. The dealer name comes from private.dealer_display_name rather than a join, because the dealers policy hides every row from logistics and the join would have emptied the board.';

-- The grant sits here rather than beside the create, and the reason is the one in
-- the admin migration. A new object in the public schema inherits the database's
-- default privileges: on the hosted project that means the whole table of
-- privileges for anon as well as authenticated, and on a database created by hand
-- it means none at all. The view was therefore readable by anonymous requests in
-- one environment and by nobody in the other, and a fresh install failed with
-- "permission denied for view delivery_board" rather than a missing grant, which is
-- what made it worth writing down.
revoke all on public.delivery_board from public, anon, authenticated;
grant select on public.delivery_board to authenticated;
