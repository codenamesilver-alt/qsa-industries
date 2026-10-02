-- ---------------------------------------------------------------------------
-- 20261003210000_expense_service_role_revoke.sql
--
-- Corrects the append-only guarantee on public.expenses.
--
-- 20261003200000 promised, at the top of its own header, "no UPDATE grant on
-- public.expenses at all. Not even for an admin. There is no code path that can
-- rewrite amount, head or date." As written and applied, that was not true.
--
-- What actually happened: the migration revoked anon and authenticated, and granted
-- select to authenticated. It said nothing about service_role, and Supabase grants
-- service_role full table privileges by default. So service_role held insert, update
-- and delete on public.expenses, verified directly against the database:
--
--   has_table_privilege('service_role', 'public.expenses', 'update')  = true
--   has_table_privilege('service_role', 'public.expenses', 'delete')  = true
--   has_table_privilege('service_role', 'public.expenses', 'insert')  = true
--
-- That matters more here than it would on an ordinary table. service_role is the key
-- that never leaves the server, so it is the role nobody thinks to audit -- which is
-- exactly why it is the role a mistake hides behind. A single careless or compromised
-- server-side statement could rewrite a recorded amount, and no policy, constraint or
-- trigger in the schema would object. The correctness of a spent-money figure would
-- then rest entirely on nobody ever writing that query, and a ledger cannot rest on
-- that.
--
-- This ships as a new forward migration rather than an edit to 20261003200000 because
-- that migration is already recorded as applied, and the README rule is that recorded
-- history is not rewritten. The same rule that keeps this migration honest is the one
-- that stopped the fix from being typed into the original file, where it would have
-- looked applied and silently done nothing.
--
-- Nothing needs the bypass that is being taken away. record_expense() and
-- void_expense() are SECURITY DEFINER and owned by the migration role, so they write
-- regardless of the calling role's table grants. service_role keeps select, so
-- server-side reporting and the export jobs keep working, and it sees the raw is_void
-- and void_reason columns rather than only the netted view. What it loses is the
-- ability to alter history from outside those two functions, which is the whole point.
--
-- The deliberate trade-off, stated so a future reader does not undo it by reflex: if
-- some correction genuinely cannot be expressed as void-plus-a-new-row, the fix is a
-- new function that records who and why -- not a grant handed back to the bypass role.
-- ---------------------------------------------------------------------------

-- Insert, update and delete are revoked together because they are revoked for one
-- reason. Leaving insert would be worse than useless: it would allow a bypass key to
-- file an expense without going through record_expense(), and so without any of the
-- validation in it -- no positive amount, no reconciling tax split, no future-date
-- check, no active-head check. A row that arrived by that route would be structurally
-- identical to a legitimate one and would silently skip every rule the module has.
revoke insert, update, delete on table public.expenses from service_role;

-- Select is granted explicitly rather than left as whatever the revoke above left
-- behind. Being explicit here means a future reader can see the intended end state of
-- this role's privileges in one place instead of inferring it from a difference.
grant select on public.expenses to service_role;

-- The same reasoning applies to the head catalogue. set_expense_head_active() and
-- upsert_expense_head() are SECURITY DEFINER and are the only sanctioned way to change
-- a head, and both re-check the caller's role internally. Direct table writes would
-- bypass those checks and could retire a head that has expenses under it without the
-- retirement being recorded as a deliberate act.
revoke insert, update, delete on table public.expense_heads from service_role;
grant select on public.expense_heads to service_role;

-- Verified end state, asserted rather than described:
--   service_role: select yes, insert/update/delete no, on both tables.
--   authenticated: select yes (RLS-filtered), insert/update/delete no.
--   anon: nothing.
--
-- The pgTAP assertions that lock this in live in stage25_expenses_test.sql, section I.
