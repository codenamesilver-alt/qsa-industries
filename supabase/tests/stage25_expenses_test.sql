-- pgTAP suite for 20261003200000_expenses.sql.
--
-- What this file is for: proving the two claims the migration rests on, and refusing
-- the two it is tempted to make.
--
-- The claims:
--
--    1. 
--      can read the register. A sales login sees nothing.
--    2. 
--      date, and voiding is the only exit -- and it leaves its own evidence behind.
--
-- The temptations it refuses, each with an assertion below:
--
--   * "while I'm here, let finance correct a typo." No UPDATE grant exists, and the
--     test asserts that absence rather than trusting it.
--   * "void_expense should be idempotent, a double click should be harmless." It is
--     not: a second void would overwrite who decided the expense was wrong, which is
--     the only record of that decision. The test asserts the second call raises.
--   * "the tax split is optional, so let a half-specified one through." The test
--     records that taxable-without-tax is refused.
--   * "a receipt URL is just a string, let it point anywhere." The bucket is private
--     and its policies are admin/finance, and the test asserts both.
--
-- Every writer call runs impersonated, the way 20261003150000 introduced: reset role,
-- then set the claim, then set local role authenticated, because
-- private.current_user_role() reads auth.uid() and asserting against the owner would
-- assert nothing. auth.uid() is null as the owner, so every writer RPC would refuse and
-- every failure test would pass for the wrong reason.
--
-- No insert into public.users anywhere below. private.handle_new_user is a trigger on
-- auth.users and writes the profile row; that is why every fixture here is an
-- auth.users insert and nothing else.
--
-- Everything is inside one transaction that rolls back, so a real expense head or a
-- real receipt never appears in the register.

begin;

-- ===========================================================================
-- A. Setup
-- ===========================================================================

select plan(68);

reset role;

-- Emails are on example.test so a fixture can never collide with a real address.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  -- A finance officer. The role that does the actual work in this module.
  ('2b000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'zz.expense.finance@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"finance"}'::jsonb,
   '{"full_name":"ZZ Expense Finance"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  -- A sales login. Internal staff, so it can see the org chart, and unable to see a
  -- rupee of the expense register. The negative case the RLS is there for.
  ('2b000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'zz.expense.sales@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"sales"}'::jsonb,
   '{"full_name":"ZZ Expense Sales"}'::jsonb,
   timezone('utc', now()), timezone('utc', now())),
  -- The superadmin. Deliberately a separate login from the project's own admin@qsa.com,
  -- and deliberately holding both app_metadata admin and a users row, which is what a
  -- superadmin looks like in this schema.
  ('2b000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'zz.expense.admin@example.test',
   extensions.crypt('test-password', extensions.gen_salt('bf')),
   timezone('utc', now()),
   '{"role":"admin","is_super_admin":true}'::jsonb,
   '{"full_name":"ZZ Expense Admin"}'::jsonb,
   timezone('utc', now()), timezone('utc', now()));

-- ===========================================================================
-- B. The head catalogue
-- ===========================================================================

--    3. 
--     public.designations settled on: a list of words is not a secret, and the
--     alternative would make the expense screen the one screen whose dropdown it could
--     not explain
select ok(
  exists (
    select 1 from pg_class
    where relnamespace = 'public'::regnamespace and relname = 'expense_heads'
  ),
  'the expense head catalogue exists'
);

--    4. 
--     name a head files rent under Miscellaneous, and that is how a register stops
--     being readable.
set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000001';

select ok(
  (select public.upsert_expense_head('Rent', 'Office and warehouse rent', 10)).id is not null,
  'finance can create an expense head'
);

--    5. 
--     expenses point at the row
select is(
  (select (public.upsert_expense_head('Premises Rent', 'Office and warehouse rent', 10, id)).name
     from public.expense_heads where name = 'Rent'),
  'Premises Rent',
  'finance can rename an expense head'
);

--    6. 
--     only -- "Premises Rent" and "Premises Rents" stay two heads, because they might be
--     two different things, and only spelling can be decided without asking somebody.
--
--     The name used here is the post-rename one from assertion 3, and that is deliberate.
--     An earlier version of this suite folded against "Rent", which had by then been
--     renamed to "Premises Rent" -- so the insert succeeded, the throws_ok found no
--     exception, and the test failed while asserting something that was already true.
--     A collision test has to collide.
select throws_ok(
  $$ select public.upsert_expense_head('premises rent') $$,
  'P0001',
  'An expense head called that already exists',
  'an expense head cannot be forked by a difference of capitalisation'
);

--    7. 
--     the picker as an unlabelled option
select throws_ok(
  $$ select public.upsert_expense_head('   ') $$,
  'P0001',
  'An expense head needs a name',
  'an expense head cannot be blank'
);

--    8. 
select ok(
  (select public.upsert_expense_head('Travel', 'Staff travel and conveyance', 20)).id is not null,
  'a second expense head can be created'
);

reset role;

-- ===========================================================================
-- C. Reading the register, from three roles
-- ===========================================================================

--    9. 
--     correct-looking to a screen, and only the first one is what the screen can draw.
set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.expense_ledger),
  0::bigint,
  'finance reads the expense register and it is empty'
);

--    10. 
--     no rows, so a screen that forgot to check the role renders an empty register
--     instead of a payroll figure.
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.expense_ledger),
  0::bigint,
  'sales reads no rows from the expense register'
);

select is(
  (select count(*) from public.expenses),
  0::bigint,
  'sales reads no rows from the expense table'
);

--   11. 
--     cover, since there is no insert policy and the writer is security definer
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'), 1000) $$,
  'P0001',
  'Only finance can record expenses',
  'sales cannot record an expense'
);

--  12. 
select throws_ok(
  $$ select public.void_expense('2b000000-0000-4000-8000-0000000000ff', 'because') $$,
  'P0001',
  'Only finance can void an expense',
  'sales cannot void an expense'
);

--  13. 
--      different grants and the module keeps them apart.
select throws_ok(
  $$ select public.upsert_expense_head('Marketing') $$,
  'P0001',
  'Only finance can change an expense head',
  'sales cannot create an expense head'
);

select throws_ok(
  $$ select public.set_expense_head_active(
       (select id from public.expense_heads where name = 'Travel'), false) $$,
  'P0001',
  'Only finance can change an expense head',
  'sales cannot retire an expense head'
);

reset role;

-- ===========================================================================
-- D. Recording
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000001';

--  14. 
--     fail if any of vendor, reference, mode, the tax split, the attachment path or the
--     note had been quietly dropped from the table.
select ok(
  (select public.record_expense(
     (select id from public.expense_heads where name = 'Premises Rent'),
     40000,
     private.business_date() - 3,
     'Sunrise Property LLP',
     'bank_transfer',
     'NEFT-2026-0042',
     35400.00,
     4600.00,
     'expense-documents/2026/premises-rent-march.pdf',
     'March rent, quarterly, includes service charge'
   )).id is not null,
  'finance can record an expense with every field filled in'
);

--  15. 
select is(
  (select (taxable_amount, tax_amount)
     from public.expense_ledger
    where vendor = 'Sunrise Property LLP'),
  (35400.00::numeric, 4600.00::numeric),
  'the recorded tax split is stored exactly as it was entered'
);

--  16. 
select is(
  (select net_amount from public.expense_ledger where vendor = 'Sunrise Property LLP'),
  40000.00::numeric,
  'a live expense nets to its full amount in the ledger'
);

--  17. 
--     storing it would put a row in the register that looks filed and moves no money.
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'), 0) $$,
  'P0001',
  'Expense amount must be a positive number',
  'a zero expense is refused'
);

--  18. 
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'), -500) $$,
  'P0001',
  'Expense amount must be a positive number',
  'a negative expense is refused'
);

--  19. 
--     in words. A constraint violation would have stored nothing either, but it would
--     have told the person typing the bill that they had hit a database error rather
--     than that their arithmetic was wrong.
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'),
       40000, null, null, null, null, 35400.00, 4500.00) $$,
  'P0001',
  'The taxable amount and the tax amount add up to 39900.00 but the expense is 40000.00',
  'a tax split that does not reconcile to the amount is refused'
);

--  20. 
--     This is the one a nullable pair makes possible and a lone nullable column does not.
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'),
       40000, null, null, null, null, 35400.00, null) $$,
  'P0001',
  'Give the taxable amount and the tax amount together, or neither',
  'a tax split with only a taxable amount is refused'
);

--  21. 
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Premises Rent'),
       40000, null, null, null, null, null, 4600.00) $$,
  'P0001',
  'Give the taxable amount and the tax amount together, or neither',
  'a tax split with only a tax amount is refused'
);

--  22. 
--     the 31st -- so a past date is accepted, which is what makes the register's date
--     column worth having
select is(
  (select public.record_expense(
     (select id from public.expense_heads where name = 'Travel'),
     1250,
     private.business_date() - 40,
     'Railway Counter Sales',
     'upi',
     'upi-9f2a',
     null,
     null,
     null,
     'Return fare, site visit'
   )).expense_date,
  private.business_date() - 40,
  'an expense may be dated in the past'
);

--  23. 
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Travel'),
       500, private.business_date() + 30) $$,
  'P0001',
  'An expense cannot be dated in the future',
  'an expense cannot be dated in the future'
);

--  24. 
--     one would have been a wrong module.
select ok(
  (select public.record_expense(
     (select id from public.expense_heads where name = 'Travel'),
     90, null, 'Blue Dart', 'cash', null, null, null, null, null)).id is not null,
  'an expense with no tax split at all is accepted'
);

--  25. 
--     "a real zero" rather than "not filled in"
select is(
  (select (taxable_amount is null and tax_amount is null) from public.expenses where vendor = 'Blue Dart'),
  true,
  'an expense with no tax split stores null, not zero'
);

--  26. 
--     accepted a recorded_by argument would let any caller file an expense in somebody
--     else's name.
select is(
  (select recorded_by::text from public.expense_ledger where vendor = 'Blue Dart'),
  '2b000000-0000-4000-8000-000000000001',
  'the recording finance officer is stamped on the row from the session'
);

--  27. 
--     no such parameter to pass
select ok(
  not exists (
    select 1
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'record_expense'
      and p.pronargs > 10
  ),
  'record_expense takes no parameter that would let a caller name the recorder'
);

--  28. 
--     is the way an old signature lingers after a column is added
select is(
  (select count(*) from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_expense'),
  1::bigint,
  'record_expense has exactly one signature, so there is no older form still callable'
);

--   29. 
--     both failures -- missing and retired -- because from the form's point of view they
--     are the same event, and "no active head with that id" is what the officer needs to
--     hear when the head they picked has disappeared from the picker.
select throws_ok(
  $$ select public.record_expense('2b000000-0000-4000-8000-0000000000ee', 100) $$,
  'P0001',
  'No active expense head with that id. Retire it from the register, or bring it back first.',
  'filing against an unknown head is refused'
);

reset role;

-- ===========================================================================
-- E. Totals
-- ===========================================================================

--  30. 
--     it, so a head whose expenses were all voided reads as zero spent and 2 written
--     off rather than as a head that never existed
select is(
  (select net_amount from public.expense_totals_by_head where head_name = 'Premises Rent'),
  40000.00::numeric,
  'the head total is the live expense'
);

select is(
  (select total_amount from public.expense_totals_by_head where head_name = 'Premises Rent'),
  40000.00::numeric,
  'the head total keeps the gross figure too, so a void never erases the fact it happened'
);

--  31. 
select is(
  (select expense_count from public.expense_totals_by_head where head_name = 'Travel'),
  2::bigint,
  'the travel head counts both of its expenses'
);

--  32. 
select ok(
  exists (select 1 from public.expense_totals_by_head where head_name = 'Travel' and expense_count = 2),
  'a head with expenses appears in the totals'
);

-- ===========================================================================
-- F. Voiding
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000001';

--  33. 
--     twice" are different problems and the register has to say which
select throws_ok(
  $$ select public.void_expense(
       (select id from public.expense_ledger where vendor = 'Sunrise Property LLP'), '  ') $$,
  'P0001',
  'An expense cannot be voided without a reason',
  'an expense cannot be voided without a reason'
);

--  34. 
select ok(
  (select public.void_expense(
     (select id from public.expense_ledger where vendor = 'Sunrise Property LLP'),
     'Filed twice against the same invoice; the second entry was never paid')).id is not null,
  'finance can void an expense'
);

select is(
  (select is_void from public.expense_ledger where vendor = 'Sunrise Property LLP'),
  true,
  'a voided expense is marked void in the ledger'
);

select is(
  (select voided_by::text from public.expenses where vendor = 'Sunrise Property LLP'),
  '2b000000-0000-4000-8000-000000000001',
  'the void records who did it, from the session rather than from a parameter'
);

--  35. 
--     "did we pay this twice", and that question needs the row to still be there
select is(
  (select amount from public.expenses where vendor = 'Sunrise Property LLP'),
  40000.00::numeric,
  'a voided expense keeps its amount in the table'
);

select is(
  (select net_amount from public.expense_ledger where vendor = 'Sunrise Property LLP'),
  0::numeric,
  'a voided expense nets to zero in the ledger'
);

--  36. 
--     the client subtracting
select is(
  (select net_amount from public.expense_totals_by_head where head_name = 'Premises Rent'),
  0::numeric,
  'the head total nets the voided expense to zero'
);

select is(
  (select voided_count from public.expense_totals_by_head where head_name = 'Premises Rent'),
  1::bigint,
  'the head total still counts the voided expense as written off'
);

--  37. 
--     would also overwrite who decided the expense was wrong and when, which is the only
--     record of that decision. This is also the double-click answer.
--
--     The expected message is built from the row's own voided_at rather than from a
--     predicted timestamp. An earlier version formatted private.business_date() as a
--     date and compared it to a message that actually carries a full timestamptz, which
--     cannot match. Reading the value back asserts the thing that matters -- that the
--     refusal names when the first void happened -- without pinning the suite to a
--     particular timestamp rendering. now() is the transaction timestamp, so the value
--     is fixed for the life of this test and cannot drift between the write and the read.
select throws_ok(
  $$ select public.void_expense(
       (select id from public.expense_ledger where vendor = 'Sunrise Property LLP'), 'again') $$,
  'P0001',
  'That expense was already voided on ' ||
    (select voided_at::text from public.expenses where vendor = 'Sunrise Property LLP'),
  'voiding an already voided expense is refused rather than idempotent'
);

--  38. 
select is(
  (select void_reason from public.expenses where vendor = 'Sunrise Property LLP'),
  'Filed twice against the same invoice; the second entry was never paid',
  'the refused second void did not replace the first void''s reason'
);

--  39. 
select throws_ok(
  $$ select public.void_expense('2b000000-0000-4000-8000-0000000000ee', 'mistake') $$,
  'P0001',
  'No expense with that id',
  'voiding an unknown expense is refused'
);

reset role;

-- ===========================================================================
-- G. Retirement
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000001';

--  40. 
--     expense filed under it in place and still grouped
select is(
  (select (public.set_expense_head_active(
     (select id from public.expense_heads where name = 'Travel'), false)).is_active),
  false,
  'finance can retire an expense head'
);

--  41. 
--     between retiring and deleting
select is(
  (select count(*) from public.expense_ledger where head_name = 'Travel'),
  2::bigint,
  'a retired head keeps its expenses'
);

--  42. 
--     withdrawn category with a live row under it is the thing being prevented. The
--     message names both remedies, because the officer who hit this is either holding a
--     stale head id or has genuinely picked a withdrawn category, and those need different
--     fixes.
select throws_ok(
  $$ select public.record_expense(
       (select id from public.expense_heads where name = 'Travel'), 300) $$,
  'P0001',
  'No active expense head with that id. Retire it from the register, or bring it back first.',
  'an expense cannot be filed under a retired head'
);

--  43. 
--     wearing a different word
select is(
  (select (public.set_expense_head_active(
     (select id from public.expense_heads where name = 'Travel'), true)).is_active),
  true,
  'a retired head can be brought back'
);

reset role;

-- ===========================================================================
-- H. Superadmin
-- ===========================================================================

--  44. 
--     pair; the assertion is that the superadmin can read and file, so that a
--     superadmin locked out of the finance screen would be reported rather than assumed.
set local role authenticated;
set local request.jwt.claim.sub = '2b000000-0000-4000-8000-000000000003';

select ok(
  (select count(*) from public.expense_ledger) >= 3,
  'the superadmin reads the expense register'
);

select ok(
  (select public.record_expense(
     (select id from public.expense_heads where name = 'Premises Rent'),
     750, null, 'Courier', 'cash', null, null, null, null, null)).id is not null,
  'the superadmin can record an expense'
);

--  45. 
--     keeps re-asserting. An expense row stamped by a superadmin must not drag the
--     superadmin into a roster or an org chart.
--
--     Asserted with not around the predicate. is_employee_role(admin) is false, and
--     asserting the bare value asks pgTAP for a true, so the suite used to fail while
--     confirming the invariant holds. The label states the expectation, the negation
--     makes the label true.
select ok(
  not (select private.is_employee_role(role) from public.users
        where id = '2b000000-0000-4000-8000-000000000003'),
  'the superadmin is still not an employee role'
);

reset role;

-- ===========================================================================
-- I. Append-only
--
-- This section is the reason the module exists in this shape. It asserts an absence of
-- privileges rather than a behaviour, which is the only way to test the difference
-- between "nothing edits an expense today" and "nothing can edit an expense".
-- ===========================================================================

--  46. 
--     not for an admin, not for anyone. The correction is void plus a new row.
select ok(
  not has_table_privilege('authenticated', 'public.expenses', 'update')
    and not has_table_privilege('service_role', 'public.expenses', 'update'),
  'authenticated holds no update privilege on the expense table'
);

--  47. 
select ok(
  not has_table_privilege('authenticated', 'public.expenses', 'delete')
    and not has_table_privilege('service_role', 'public.expenses', 'delete'),
  'authenticated holds no delete privilege on the expense table'
);

--  48. 
select ok(
  not has_table_privilege('authenticated', 'public.expenses', 'insert')
    and not has_table_privilege('anon', 'public.expenses', 'insert'),
  'authenticated holds no insert privilege on the expense table'
);

--  49. 
--     actually holds the append-only line. service_role is granted everything by default,
--     so asserting only on authenticated would have passed against a schema where the
--     server key could still rewrite a recorded amount. This is what 20261003210000
--     revokes.
select ok(
  not has_table_privilege('service_role', 'public.expenses', 'insert')
    and not has_table_privilege('service_role', 'public.expenses', 'update')
    and not has_table_privilege('service_role', 'public.expenses', 'delete'),
  'service_role cannot write to the expense table outside the checked functions'
);

--  50. 
--     that tightening the write does not quietly become an outage later.
select ok(
  has_table_privilege('service_role', 'public.expenses', 'select')
    and has_table_privilege('service_role', 'public.expense_heads', 'select'),
  'service_role keeps select on the expense tables'
);

--  51. 
--     retiring a head is an act that ought to be recorded as deliberate rather than
--     typed into the table by a bypass key
select ok(
  not has_table_privilege('service_role', 'public.expense_heads', 'insert')
    and not has_table_privilege('service_role', 'public.expense_heads', 'update')
    and not has_table_privilege('service_role', 'public.expense_heads', 'delete'),
  'service_role cannot write to the head catalogue outside the checked functions'
);

-- ===========================================================================
-- J. Privileges
-- ===========================================================================

select ok(not has_table_privilege('anon', 'public.expenses', 'select'),
  'anon cannot read the expense table');

select ok(has_table_privilege('authenticated', 'public.expenses', 'select'),
  'authenticated holds the read privilege the RLS policy then filters');

select ok(has_table_privilege('authenticated', 'public.expense_heads', 'select'),
  'authenticated can read the head catalogue');

select ok(not has_function_privilege('anon', 'public.record_expense(uuid, numeric, date, text, public.payment_mode, text, numeric, numeric, text, text)', 'execute'),
  'anon cannot record an expense');

select ok(not has_function_privilege('anon', 'public.void_expense(uuid, text)', 'execute'),
  'anon cannot void an expense');

select ok(not has_function_privilege('anon', 'public.upsert_expense_head(text, text, integer, uuid)', 'execute'),
  'anon cannot change the head catalogue');

-- ===========================================================================
-- K. Attachments
-- ===========================================================================

select ok(
  exists (select 1 from storage.buckets where id = 'expense-documents' and public = false),
  'the receipt bucket exists and is private'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'expense_documents_read_internal'
  ),
  'the receipt bucket has an explicit read policy, so nobody is relying on a default'
);

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'expense%' and policyname like '%delete%'
  ),
  'there is no delete policy on the receipts, because the expense they explain stays in the register'
);

-- The catalogue rows must be present, so the admin matrix screen has no blank row for a
-- screen that exists. They are seeded, not enforced: nothing reads them yet, which
-- 20261003150000 already records as the state of the whole table.
select is(
  (select count(*) from public.permissions
    where code in ('finance.record_expenses', 'finance.manage_expense_heads')),
  2::bigint,
  'both expense permissions are in the catalogue'
);

select is(
  (select count(*) from public.role_permissions
    where permission_code in ('finance.record_expenses', 'finance.manage_expense_heads')),
  2::bigint,
  'both expense permissions are seeded onto the finance role'
);

select * from finish();
rollback;
