-- Make the direct client write paths reachable, and close the two escalations
-- that granting them would otherwise open.
--
-- 20260926100300 wrote two UPDATE policies on dealers, and stage11 tested them
-- by resetting to the owner role. That test passed, and it was misleading: a
-- policy is a row filter, not a permission. Postgres checks the table privilege
-- before it ever consults row level security, and authenticated held only
-- SELECT on dealers. So both policies were unreachable and the features behind
-- them, the finance credit and region override and the dealer editing their own
-- contact details, had never once run as a real signed-in user.
--
-- The same mistake is not confined to dealers. Across the schema, twelve write
-- policies were unreachable for want of a grant:
--
--   dealers                dealers_update_internal, dealers_update_scope
--   production_runs        production_runs_update_internal
--   products               products_update_threshold
--   users                  users_update_self
--   purchase_orders        purchase_orders_write_internal        (rpc only)
--   purchase_order_lines   purchase_order_lines_write_internal   (rpc only)
--
-- The production_runs one is the sharpest, because web/src/components/
-- production-qc-actions.tsx performs a direct .update({ qc_status, qc_notes })
-- and therefore could never have succeeded from the browser.
--
-- The purchase_orders and purchase_order_lines policies are deliberately left
-- alone. Every write to those two tables goes through a SECURITY DEFINER
-- function, which runs as the owner and is not subject to these policies at
-- all, so the policies are inert rather than wrong. They are kept because a future
-- SECURITY INVOKER function would need them, and removing them would turn a
-- harmless redundancy into a bug.
--
-- raw_materials is a third case and is not in that group. It already grants
-- INSERT and UPDATE to authenticated for the internal roles its ALL policy names,
-- so its write path is real. What it deliberately does not grant is DELETE, which
-- is why the policy is wider than the grants: production history references these
-- rows, and the narrower grant is what stops a browser from orphaning it.
--
-- Two of the four live grants would be unsafe as blanket table grants, so they
-- are column grants instead:
--
--   users_update_self       row filter is "my own row". Given the whole table a
--                           user could have set their own role to admin. Role is
--                           not granted.
--   products_update_threshold
--                           row filter is "I am an inventory manager". Given the
--                           whole table that manager could have repriced the
--                           catalogue or marked a product sellable. Only the
--                           threshold column is granted.
--
-- Granting dealers UPDATE also exposes a column the guard in 20260926100300 does
-- not police: sales_rep_id. A dealer editing their own row under
-- dealers_update_scope could have reassigned their own account. That is fixed in
-- 20260926100700, separately, because it is a change to the rule rather than to
-- the grants and it deserves its own record.

-- ---------------------------------------------------------------------------
-- The grants the policies were written for
-- ---------------------------------------------------------------------------

-- Row level security does the scoping and the guard above does the column
-- policing, so the table grant only has to exist.
grant update on public.dealers to authenticated;

-- QC is a verdict against a run that has already been recorded, so only the two
-- QC columns are writable. validate_production_qc_update enforces the same rule
-- from the other side, and keeping both means neither a missing trigger nor a
-- missing grant can open the field up on its own.
grant update (qc_status, qc_notes) on public.production_runs to authenticated;

-- Replenishment thresholds only. Price, sellable flag, tax code, name and
-- category are commercial or catalogue data and stay out of reach of the roles
-- this policy was written for.
grant update (low_stock_threshold) on public.products to authenticated;

-- Self-service profile edits only. role, is_active and dealer_id are the three
-- columns that would turn a profile form into a privilege escalation, and none
-- of them is granted.
grant update (full_name, phone) on public.users to authenticated;

-- --------------------------------------------------------------------------
-- Record the intent, so the next reader does not have to rediscover it
-- --------------------------------------------------------------------------

comment on table public.purchase_orders is
  'Written only through create_purchase_order and receive_purchase_order, both SECURITY DEFINER. The write policies on this table and on purchase_order_lines are therefore inert; they are retained for a future SECURITY INVOKER path and are not evidence that the browser can write here.';

comment on table public.purchase_order_lines is
  'Written only through the SECURITY DEFINER purchase order functions. See the note on purchase_orders.';

comment on table public.raw_materials is
  'Editable from the browser by admin, production_manager and inventory_manager, who hold INSERT and UPDATE through raw_materials_write_internal. DELETE is not granted to authenticated on purpose: production history references these rows, so the narrower grant is what keeps that history from being orphaned.';

comment on table public.dealers is
  'The browser may UPDATE this table, but only through the two dealers update policies: a dealer on their own row, or admin and finance on any row. Column policing for credit_limit, credit_limit_override, status, region and sales_rep_id is done by private.guard_dealer_commercial_columns, not by the grant.';

comment on table public.users is
  'Authenticated may update only full_name and phone on their own row. role, is_active and dealer_id are not granted to the browser, so a signed-in user cannot promote themselves or reactivate a disabled account.';
