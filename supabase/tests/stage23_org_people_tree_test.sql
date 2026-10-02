begin;
select plan(37);

-- Tests for the people org chart: 20261003110000_people_org_chart.sql,
-- 20261003130000_org_people_visible_to_internal_staff.sql and
-- 20261003170000_super_admin_is_not_an_employee.sql.
--
-- What these two migrations add. A reporting line stored on the person rather than
-- on a post: users.reports_to_id, users.sort_order, two views that project it, and
-- three admin functions that write it -- admin_set_reports_to,
-- admin_clear_org_chart, and the multiple-heads repair to the post functions.
--
-- The conventions are stage21's, for the same reasons. Every function call runs
-- impersonated, as reset role followed by set local role authenticated and a
-- request.jwt.claim.sub, because private.current_user_role() reads auth.uid() and
-- asserting against the owner would prove nothing. Every fixture is written as the
-- owner in between those impersonations. Users created here carry
-- 19000000-...-000000000060 onward, outside the seed and outside stage21, so
-- nothing below can collide with another suite.
--
-- Two seeds matter below:
--   admin     10000000-0000-4000-8000-000000000001
--   qc_staff  7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--
-- The qc_staff seed is the load-bearing one. 20261003110000 justified its
-- security_invoker views over public.users on the grounds that the audience is
-- admin, and 20261003130000 had to rebuild both of them because a quality chemist
-- opening the chart saw one box. "A non-admin internal reader sees the whole
-- company" is asserted below on purpose: it is the thing the first version got
-- wrong and the thing a reader would notice.

-- ===========================================================================
-- A. Fixtures
--
-- A company with the shape the business actually has: a CEO, two partners who do
-- not report to the CEO, and a chemist under one of them. Two top heads is the
-- whole point, so the fixture is built to need two and every assertion below would
-- fail against a single-root model.
-- ===========================================================================
reset role;

-- The company as it was before this suite added anybody, so the counts below are
-- deltas rather than absolutes. The live database has employees in it; a test that
-- hard-coded the number would fail on a database that has been used.
--
-- The baseline counts through private.is_employee_role rather than
-- "role <> 'dealer'", which reads as if the chart only ever hid dealers. Since
-- 20261003170000 it also hides the portal super admin, so a dealer-only baseline
-- counts the super admin as an employee and every chart count below comes up one
-- short. is_employee_role is the same predicate the chart itself filters on, so
-- base and the counts it feeds can no longer disagree about who an employee is.
create temporary table base as
  select count(*)::int as people
  from public.users
  where private.is_employee_role(role);
grant select on base to authenticated;

create temporary table people (label text primary key, user_id uuid);
grant insert, select on people to authenticated;

-- Three titles in the catalogue, so the join to designations has something to
-- resolve. Written straight into the table because the writer function refuses
-- anybody who is not an admin and this block runs before a claim is set.
insert into public.designations (name)
values ('Suite CEO'), ('Suite Partner'), ('Suite Chemist')
on conflict (name) do nothing;

-- A dealer login, written directly rather than through admin_create_user_account
-- because that function wants a dealer to attach it to and this suite is not
-- about dealers. It exists to prove the chart does not draw customers.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000060', 'authenticated', 'authenticated',
  'suite.dealer@qsa-test.in',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"role":"dealer"}'::jsonb,
  '{"full_name":"Suite Dealer"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

-- No insert into public.users: private.handle_new_user is a trigger on auth.users and
-- writes the profile row itself. Writing it again here would be a duplicate key, and
-- it is worth being explicit about that because it is the reason every fixture in
-- every suite in this directory is an auth.users insert and nothing else.

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into people (label, user_id)
select 'ceo', id from public.admin_create_user_account(
  'suite.ceo@qsa-test.in', 'Asha Rao', 'suite-password', 'production_manager',
  (select id from public.designations where name = 'Suite CEO'));

insert into people (label, user_id)
select 'partner_one', id from public.admin_create_user_account(
  'suite.partner.one@qsa-test.in', 'Bilal Khan', 'suite-password', 'production_manager',
  (select id from public.designations where name = 'Suite Partner'));

insert into people (label, user_id)
select 'partner_two', id from public.admin_create_user_account(
  'suite.partner.two@qsa-test.in', 'Chitra Menon', 'suite-password', 'production_manager',
  (select id from public.designations where name = 'Suite Partner'));

insert into people (label, user_id)
select 'chemist', id from public.admin_create_user_account(
  'suite.chemist@qsa-test.in', 'Dev Patel', 'suite-password', 'qc_staff',
  (select id from public.designations where name = 'Suite Chemist'));

-- The shape. Bilal reports to the CEO, the chemist reports to Bilal, and Chitra
-- reports to nobody at all: a partner who does not report to the CEO.
select public.admin_set_reports_to(
  (select user_id from people where label = 'partner_one'),
  (select user_id from people where label = 'ceo'));

select public.admin_set_reports_to(
  (select user_id from people where label = 'chemist'),
  (select user_id from people where label = 'partner_one'));

-- ===========================================================================
-- B. The views
-- ===========================================================================

-- 1. one row per employee, and the dealer is not one of them
select is(
  (select count(*) from public.org_people_tree),
  ((select people from base) + 4)::bigint,
  'org_people_tree carries every employee and no dealer login'
);

-- 2. a customer is not drawn on the company's chart, even with a login
select is(
  (select count(*) from public.org_people_tree where user_id = '19000000-0000-4000-8000-000000000060'),
  0::bigint,
  'a dealer login does not appear on the org chart'
);

-- 3. the reporting line, read back
select is(
  (select reports_to_id from public.org_people_tree where user_id = (select user_id from people where label = 'chemist')),
  (select user_id from people where label = 'partner_one'),
  'the chemist reports to the partner they were placed under'
);

-- 4. and the view carries the name and title of that person, so the box can say who
--     it reports to without the client walking the tree again
select is(
  (select reports_to_name from public.org_people_tree where user_id = (select user_id from people where label = 'chemist')),
  'Bilal Khan',
  'the view carries the name of the person reported to'
);

select is(
  (select reports_to_designation from public.org_people_tree where user_id = (select user_id from people where label = 'chemist')),
  'Suite Partner',
  'and that person''s job title, resolved through the catalogue'
);

-- 5. two heads. This is the assertion 20260928110000 could not have made and the
--     one the business asked for: the partners do not report to the CEO.
select is(
  (select count(*) from public.org_people_tree
    where user_id in (select user_id from people)
      and reports_to_id is null),
  2::bigint,
  'two of the four people report to nobody, which is a CEO and a partner'
);

-- 6. a head has nobody above them, and the view says so with nulls rather than
--    omitting the columns
select is(
  (select reports_to_name from public.org_people_tree where user_id = (select user_id from people where label = 'partner_two')),
  null,
  'a head has no name above them'
);

-- 7. the person's own designation travels with the row
select is(
  (select designation from public.org_people_tree where user_id = (select user_id from people where label = 'ceo')),
  'Suite CEO',
  'each row carries the person''s own job title'
);

-- 8. org_people is the same rows without the reporting-line joins, for a screen
--     that only wants the list
select is(
  (select count(*) from public.org_people),
  ((select people from base) + 4)::bigint,
  'org_people and org_people_tree agree on how many employees there are'
);

-- 9. a non-admin internal reader sees the company. 20261003110000 got this wrong:
--    both views were security_invoker over public.users, whose policy admits an
--    internal reader to their own row and no other, so this count was 1.
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select is(
  (select count(*) from public.org_people_tree),
  ((select people from base) + 4)::bigint,
  'a quality chemist opening the chart sees the whole company, not one box'
);

select is(
  (select reports_to_name from public.org_people_tree where user_id = (select user_id from people where label = 'ceo')),
  null,
  'and can read who reports to whom'
);

-- 10. which is the post chart's property too, so the two views agree about who may
--     read the org
select is(
  (select count(*) from public.org_staff_roster),
  ((select people from base) + 4)::bigint,
  'the post-model roster and the people chart admit the same readers'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- C. admin_set_reports_to
--
-- Two refusals, both about the shape rather than the business: nobody reports to
-- themselves, and no move closes a loop.
-- ===========================================================================

-- 11. self
select throws_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'ceo'),
       (select user_id from people where label = 'ceo')) $$,
  'Somebody cannot report to themselves',
  'a person cannot be their own manager'
);

-- 12. the one-hop cycle is caught by the constraint, but the function says it in
--     words the operator can act on rather than letting the constraint raise
select throws_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'ceo'),
       (select user_id from people where label = 'partner_one')) $$,
  'That would create a loop: they already sit above this person in the chart',
  'a move that would put a manager under their own report is refused'
);

-- 13. and the refusal left the line alone, which is the part that is easy to get
--     wrong: a check that raises after the update has been written loses the line
select is(
  (select reports_to_id from public.users where id = (select user_id from people where label = 'ceo')),
  null,
  'the refused move left the CEO at the top of the chart'
);

-- 14. somebody who is not an account
select throws_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'chemist'),
       '00000000-0000-0000-0000-0000000000ff') $$,
  'No user with that id to report to',
  'a reporting line to a person who does not exist is refused'
);

-- 15. and the same, for the person being moved
select throws_ok(
  $$ select public.admin_set_reports_to(
       '00000000-0000-0000-0000-0000000000ff',
       (select user_id from people where label = 'ceo')) $$,
  'No user with that id',
  'a reporting line for somebody who does not exist is refused'
);

-- 18. and nobody can report to a customer. Added in 20261003140000: the dealer is a
--     row in public.users, so the existence check passed and the line was written --
--     and then invisible, because the manager's own row is filtered out of
--     org_people_tree, leaving a box whose "Reports to" was blank with a subtree
--     hanging off it.
select throws_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'chemist'),
       '19000000-0000-4000-8000-000000000060') $$,
  'A dealer login is not part of the company chart',
  'a dealer login cannot be put at the head of the org chart'
);

-- 18a. and the refusal left the line alone
select is(
  (select reports_to_id from public.users where id = (select user_id from people where label = 'chemist')),
  (select user_id from people where label = 'partner_one'),
  'the refused dealer reporting line left the chemist where they were'
);

-- 18b. nor can a dealer be moved onto the chart in the first place, which is the
--      same exclusion seen from the other end
select throws_ok(
  $$ select public.admin_set_reports_to(
       '19000000-0000-4000-8000-000000000060', null) $$,
  'A dealer login is not part of the company chart',
  'a dealer login cannot be given a place on the org chart'
);

-- 17. null is meaningful: it makes a head of the company, which is not the same
--     thing as "leave it alone"
select lives_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'chemist'), null) $$,
  'a person can be promoted to the top of the company'
);

select is(
  (select reports_to_id from public.users where id = (select user_id from people where label = 'chemist')),
  null,
  'and null writes null rather than being ignored'
);

-- 18. put them back, so the later assertions have the shape they expect
select public.admin_set_reports_to(
  (select user_id from people where label = 'chemist'),
  (select user_id from people where label = 'partner_one'));

-- 19. the deep case the recursive walk exists for. The chemist is under the partner
--     and the partner is under the CEO, so putting the CEO under the chemist closes
--     a loop two hops up, which a check that only looked one level out would miss.
select throws_ok(
  $$ select public.admin_set_reports_to(
       (select user_id from people where label = 'ceo'),
       (select user_id from people where label = 'chemist')) $$,
  'That would create a loop: they already sit above this person in the chart',
  'a loop closed two hops up is refused, not just a loop closed in one'
);

-- 20. and the refused move left the chain exactly as it was
select is(
  (select reports_to_id from public.users where id = (select user_id from people where label = 'partner_one')),
  (select user_id from people where label = 'ceo'),
  'the refused deep move left the reporting line alone'
);

-- ===========================================================================
-- D. admin_clear_org_chart
-- ===========================================================================

-- 21. only an admin
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select throws_ok(
  $$ select public.admin_clear_org_chart() $$,
  'Only an admin can clear the organisation chart',
  'a quality chemist cannot clear the chart'
);

set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- 22. it returns the number of lines it removed, not the number of rows it visited.
--     The 20261003110000 version updated every employee whose reports_to_id was
--     already null and counted that as work, which is how a no-op announces "17
--     people cleared".
--
--     Compared against a snapshot taken here rather than against a fixed number,
--     for the reason the fixture comment at the top of this file gives: this
--     function counts every line in the company, so on a database somebody has
--     actually used the answer is not a constant. An earlier version of this
--     assertion hard-coded 2 and started failing the first time an admin placed a
--     real person on the real chart -- which is the whole point of the header
--     warning, being ignored by the assertion two screens below it.
create temporary table lines_before as
  select count(*)::int as n
  from public.users
  where private.is_employee_role(role)
    and reports_to_id is not null;
grant select on lines_before to authenticated;

select is(
  (select public.admin_clear_org_chart()),
  (select n from lines_before),
  'clearing the chart counts the reporting lines it removed, not the rows it visited'
);

-- 23. and afterwards every employee is a head of the company
select is(
  (select count(*) from public.users where private.is_employee_role(role) and reports_to_id is not null),
  0::bigint,
  'every employee is a head of the company once the chart is cleared'
);

-- 24. and the accounts are still there afterwards. This is the assertion the whole
--     migration was written around: the chart is a shape, not a set of logins.
select is(
  (select count(*) from public.users where id in (select user_id from people)),
  4::bigint,
  'clearing the chart deleted no logins'
);

-- 25. calling it twice is a no-op rather than a second round of "clearing", which
--     is the other half of a count that means something
select is(
  (select public.admin_clear_org_chart()),
  0,
  'clearing an already clear chart changes nothing and says so'
);

-- 26. the dealer is still not in the chart after all of it
select is(
  (select count(*) from public.org_people_tree where user_id = '19000000-0000-4000-8000-000000000060'),
  0::bigint,
  'the dealer login was never on the chart and clearing did not put it there'
);

-- ===========================================================================
-- E. Privileges
-- ===========================================================================

select ok(not has_table_privilege('anon', 'public.org_people_tree', 'select'),
  'anon cannot read the org chart');

select ok(has_table_privilege('authenticated', 'public.org_people_tree', 'select'),
  'authenticated can read the org chart');

select ok(has_table_privilege('authenticated', 'public.org_people', 'select'),
  'authenticated can read the flat employee list');

select ok(not has_function_privilege('anon', 'public.admin_set_reports_to(uuid, uuid)', 'execute'),
  'anon cannot move anybody on the chart');

select ok(not has_function_privilege('anon', 'public.admin_clear_org_chart()', 'execute'),
  'anon cannot clear the chart');

-- 27. the old signature is gone rather than left behind doing nothing
select ok(
  not exists (
    select 1
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_clear_org_chart'
      and p.pronargs = 1
  ),
  'admin_clear_org_chart has no leftover one-argument form'
);

select ok(has_function_privilege('authenticated', 'private.org_people_rows()', 'execute'),
  'authenticated can call the row function the chart reads, which is what admits internal staff');

select * from finish();
rollback;