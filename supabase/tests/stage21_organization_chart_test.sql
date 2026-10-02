begin;
select plan(62);
-- Tests for 20260928110000_organization_chart.sql.
--
-- What this migration adds. A table of posts, one row per box in an organization
-- chart, with a self-referencing parent; a read path every internal role can use
-- and nobody else can; and four admin functions that write it.
--
-- The conventions are stage19's, for the same reasons:
--
--   * Every function call runs impersonated, as reset role followed by
--     set local role authenticated and a request.jwt.claim.sub, because
--     private.current_user_role() reads auth.uid() and asserting against the owner
--     would prove nothing: the owner is never stopped by the check.
--   * Every fixture is written as the owner, in between those impersonations.
--   * The chart is emptied at the start, as the owner, because it has no rows in a
--     real database and a leftover root from another run would make the one-root
--     assertions fail for the wrong reason.
--
-- Fixed identifiers, from the seed and earlier migrations:
--   admin     10000000-0000-4000-8000-000000000001
--   rep Ravi  10000000-0000-4000-8000-000000000005
--   finance   22145f21-ebba-4e23-8bc5-b9650307a4ea
--   qc_staff  7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--
-- Users created here carry 19000000-...-000000000020 onward, outside the seed and
-- outside stage19, so nothing below can collide with another suite.

-- ===========================================================================
-- A. Fixtures
--
-- Three accounts, each of which is a case the chart has an opinion about: a
-- manager who can hold a post, a dealer login who cannot, and a suspended member
-- of staff who can still be shown on a box they have not left.
-- ===========================================================================
reset role;

delete from public.org_positions;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '19000000-0000-4000-8000-000000000020', 'authenticated', 'authenticated',
    'post.manager@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"production_manager"}'::jsonb,
    '{"full_name":"Post Manager"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000021', 'authenticated', 'authenticated',
    'post.dealer@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"Post Dealer"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000022', 'authenticated', 'authenticated',
    'post.departed@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"logistics"}'::jsonb,
    '{"full_name":"Departed Logistics"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

-- The trigger left this one active, and the chart is about to say something about
-- suspended accounts, so the flag is set here rather than left to chance.
update public.users set is_active = false where id = '19000000-0000-4000-8000-000000000022';

-- Scratch ids, so the assertions below can name a post without repeating a uuid.
create temporary table op (label text primary key, position_id uuid);
grant insert, select on op to authenticated;

-- ===========================================================================
-- B. Building a chart as the admin
--
-- CEO over a director over two managers, one post left vacant, and the
-- production manager sitting in two of them, which is the case the table allows on
-- purpose.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into op (label, position_id)
select 'ceo', id from public.admin_create_org_position(null, 'Chief Executive Officer', '10000000-0000-4000-8000-000000000001');

insert into op (label, position_id)
select 'director', id
from public.admin_create_org_position((select position_id from op where label = 'ceo'), 'Director', '22145f21-ebba-4e23-8bc5-b9650307a4ea');

insert into op (label, position_id)
select 'production', id
from public.admin_create_org_position((select position_id from op where label = 'director'), 'Head of Production', '19000000-0000-4000-8000-000000000020');

-- Vacant on purpose: a post is created before it is filled, and a chart that
-- cannot show an empty box cannot show a job that is open.
insert into op (label, position_id)
select 'quality', id
from public.admin_create_org_position((select position_id from op where label = 'director'), 'Quality Lead');

insert into op (label, position_id)
select 'dispatch', id
from public.admin_create_org_position((select position_id from op where label = 'ceo'), 'Dispatch Desk', '19000000-0000-4000-8000-000000000020');

select is(
  (select title from public.org_positions where id = (select position_id from op where label = 'ceo')),
  'Chief Executive Officer',
  'the top head keeps the title it was given'
);

select is(
  (select parent_id from public.org_positions where id = (select position_id from op where label = 'ceo')),
  null::uuid,
  'and has no parent, which is what makes it the top head'
);

select is(
  (select parent_id from public.org_positions where id = (select position_id from op where label = 'director')),
  (select position_id from op where label = 'ceo'),
  'a post added under the head carries the head as its parent'
);

select is(
  (select count(*)::int from public.org_positions where user_id = '19000000-0000-4000-8000-000000000020'),
  2,
  'one person holding two posts is recorded twice rather than refused, because it is a fact a company operates under'
);

select is(
  (select count(*)::int from public.org_positions where user_id is null),
  1,
  'a vacant post is a null occupant, not a missing row'
);

-- Sibling order. Neither post was given a number, so the order is the order they
-- were made in.
select is(
  (select sort_order from public.org_positions where id = (select position_id from op where label = 'production')),
  0,
  'the first post under a level takes slot zero'
);

select is(
  (select sort_order from public.org_positions where id = (select position_id from op where label = 'quality')),
  1,
  'and the second takes the next slot, so the screen has a stable order without anyone choosing one'
);

-- ===========================================================================
-- C. Reading it
--
-- The read path is the reason private.org_person exists. public.users is invisible
-- to internal staff beyond their own row, so a chart that joined users would show
-- five empty boxes to everybody but the admin. These assertions are what the
-- read-through-a-function was written to prevent.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select is(
  (select count(*)::int from public.org_chart),
  5,
  'a QC user reads every post in the chart'
);

select is(
  (select user_full_name from public.org_chart where id = (select position_id from op where label = 'production')),
  'Post Manager',
  'and sees the name on it, which the users policy alone would not have given them'
);

select is(
  (select user_full_name from public.org_chart where id = (select position_id from op where label = 'quality')),
  null::text,
  'a vacant post reads as vacant rather than as a person nobody can name'
);

select is(
  (select user_role from public.org_chart where id = (select position_id from op where label = 'director')),
  'finance'::public.user_role,
  'the login role travels with the name, so a chart can be read against permissions'
);

-- The picker behind the chart reads public.org_staff_roster and not the private
-- function, because PostgREST does not expose the private schema at all. That
-- wrapper is the difference between a working picker and a 404 in production, and
-- a 404 is not a thing a pgTAP assertion in SQL would have caught, so it is
-- asserted here as the count of rows the browser would get.
select is(
  (select count(*)::int from public.org_staff_roster)
    = (select count(*)::int from private.org_staff_roster()),
  true,
  'the public roster view and the private function return the same rows, so the view is the only difference'
);

select is(
  (select count(*)::int from public.org_staff_roster where user_id = '10000000-0000-4000-8000-000000000005'),
  1,
  'a sales rep is on the roster: a post is not restricted to warehouse and office staff'
);

select is(
  (select count(*)::int from public.org_staff_roster where user_id = '19000000-0000-4000-8000-000000000021'),
  0,
  'a dealer login is not on the roster, so a customer account cannot be given a post'
);

select is(
  (select count(*)::int from public.org_staff_roster where email is null),
  0,
  'every roster row carries an email, so the picker can tell two people with the same name apart'
);

-- A dealer login is a customer account. It gets no rows and no error, because a
-- policy filters rather than refusing.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-000000000021';

select is(
  (select count(*)::int from public.org_chart),
  0,
  'a dealer login reads no rows of the chart'
);

select is(
  (select count(*)::int from public.org_staff_roster),
  0,
  'and no staff roster, so the picker is empty rather than a leaked directory'
);

-- The same for a sales login: the chart describes the company, and sales work in
-- the sales portal.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select is(
  (select count(*)::int from public.org_chart),
  0,
  'a sales rep reads no rows of the chart either'
);

-- A suspended member of staff loses it, because current_user_role() is null for a
-- suspended account and is_internal_staff() is built on that.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-000000000022';

select is(
  (select count(*)::int from public.org_chart),
  0,
  'a suspended member of staff reads no rows'
);

-- But their post is still on the chart for everybody else, and says so. A chart
-- that quietly drops a person the moment their login is suspended is a chart that
-- lies about the shape of the company.
reset role;

update public.org_positions
   set user_id = '19000000-0000-4000-8000-000000000022'
 where id = (select position_id from op where label = 'quality');

set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select is(
  (select user_is_active from public.org_chart where id = (select position_id from op where label = 'quality')),
  false,
  'a post held by a suspended member of staff is still shown, marked inactive'
);

select is(
  (select count(*)::int from public.org_chart),
  5,
  'so the chart has the same five posts as before, and the vacant box simply filled'
);

-- ===========================================================================
-- D. Several heads
--
-- Inverted by 20261003120000. This section used to assert the opposite: that a second
-- root was refused, on the grounds that two roots render as two companies on one
-- screen. That was the right call about the shape and the wrong call about the
-- business -- a firm has a chief executive and partners, and the partners do not
-- report to the chief executive. A chart that cannot draw that is not protecting the
-- truth, it is withholding it.
--
-- The assertions below now assert that several tops are allowed, and that promoting
-- a post to the top is how you get there. Both root posts are left in place for the
-- rest of the suite, which does not care how many there are.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_create_org_position(null, 'Second Chief Executive')$$,
  'a second top head is allowed, because a firm can have a CEO and a partner who is not under them'
);

select lives_ok(
  $$select public.admin_move_org_position(
    (select position_id from op where label = 'dispatch'),
    null
  )$$,
  'and an existing post can be promoted to the top, which is how a partner post gets set up'
);

select ok(
  (select count(*)::int from public.org_positions where parent_id is null) >= 2,
  'and the single-root index really is gone, not merely unused'
);

-- ===========================================================================
-- E. Cycles
--
-- The move is the only writer that can make the tree cyclic, so the move is the
-- one that carries the walk. A cycle is not a rendering bug: a recursive read of
-- one does not return.
-- ===========================================================================
select throws_ok(
  $$select public.admin_move_org_position(
    (select position_id from op where label = 'ceo'),
    (select position_id from op where label = 'ceo')
  )$$,
  'P0001',
  'A position cannot report to itself',
  'a post cannot be moved under itself'
);

select throws_ok(
  $$select public.admin_move_org_position(
    (select position_id from op where label = 'director'),
    (select position_id from op where label = 'production')
  )$$,
  'P0001',
  'That would put a position above its own reports',
  'a post cannot be moved under something that already reports to it, which is the cycle the table constraint cannot see'
);

select throws_ok(
  $$select public.admin_move_org_position(
    (select position_id from op where label = 'ceo'),
    (select position_id from op where label = 'quality')
  )$$,
  'P0001',
  'That would put a position above its own reports',
  'a grandchild counts: the walk is over the whole subtree, not only the immediate reports'
);

-- A legal move, so the three refusals above are refusals and not a broken move.
-- The move returns void, so it is a statement and the state it left is the
-- assertion: reading a void call as a value would test Postgres' type system
-- rather than the move.
select public.admin_move_org_position(
  (select position_id from op where label = 'dispatch'),
  (select position_id from op where label = 'director')
);

select is(
  (select parent_id from public.org_positions where id = (select position_id from op where label = 'dispatch')),
  (select position_id from op where label = 'director'),
  'a move under a different post takes effect'
);

select is(
  (select sort_order from public.org_positions where id = (select position_id from op where label = 'dispatch')),
  2,
  'and lands at the end of its new level, because no slot was asked for'
);

-- ===========================================================================
-- F. Dealers are not employees
--
-- One refusal, stated once, on the create and the update path alike, so the two
-- cannot drift into disagreeing about whether a customer is staff.
-- ===========================================================================
select throws_ok(
  $$select public.admin_create_org_position(
    (select position_id from op where label = 'ceo'),
    'Dealer Liaison',
    '19000000-0000-4000-8000-000000000021'
  )$$,
  'P0001',
  'A position can only be held by a staff account, and no staff account has that id',
  'a dealer login cannot be put on a post at creation'
);

select throws_ok(
  $$select public.admin_update_org_position(
    (select position_id from op where label = 'quality'),
    null,
    '19000000-0000-4000-8000-000000000021'
  )$$,
  'P0001',
  'A position can only be held by a staff account, and no staff account has that id',
  'and cannot be moved onto one afterwards either'
);

select throws_ok(
  $$select public.admin_create_org_position(
    (select position_id from op where label = 'ceo'),
    'Nobody At All',
    'ffffffff-ffff-4fff-8fff-ffffffffffff'
  )$$,
  'P0001',
  'A position can only be held by a staff account, and no staff account has that id',
  'an id with no profile behind it is refused by the same rule, so the message cannot be read as a dealer-only complaint'
);

-- ===========================================================================
-- G. The update rules
--
-- p_clear_user exists because "no argument" and "empty" are different
-- instructions. These five assertions are the difference.
-- ===========================================================================
select is(
  (public.admin_update_org_position(
    (select position_id from op where label = 'quality'),
    'Quality Manager'
  )).title,
  'Quality Manager',
  'a rename takes'
);

select is(
  (public.admin_update_org_position(
    (select position_id from op where label = 'quality'),
    null,
    '19000000-0000-4000-8000-000000000020'
  )).user_id,
  '19000000-0000-4000-8000-000000000020'::uuid,
  'a person can be put on a post without touching its title'
);

select is(
  (public.admin_update_org_position(
    (select position_id from op where label = 'quality'),
    null
  )).user_id,
  '19000000-0000-4000-8000-000000000020'::uuid,
  'and a call with no person argument leaves the occupant alone, which is why clearing needs its own flag'
);

select is(
  (public.admin_update_org_position(
    (select position_id from op where label = 'quality'),
    null,
    null,
    true
  )).user_id,
  null::uuid,
  'and only the flag clears it'
);

select throws_ok(
  $$select public.admin_create_org_position(
    (select position_id from op where label = 'ceo'),
    '   '
  )$$,
  'P0001',
  'A position needs a title',
  'a blank title is refused rather than stored as a box with no name'
);

-- ===========================================================================
-- H. Deleting
--
-- The only destructive call in the portal, so it carries two guards. A post with
-- reports is refused unless it is the top head, and the top head is the one move
-- that can only ever clear the whole chart.
-- ===========================================================================
select throws_ok(
  $$select public.admin_delete_org_position((select position_id from op where label = 'ceo'))$$,
  'P0001',
  'This position still has positions below it. Delete or move them first',
  'the top head cannot be deleted while anything is under it'
);

select throws_ok(
  $$select public.admin_delete_org_position(
    (select position_id from op where label = 'director'),
    true
  )$$,
  'P0001',
  'Only the whole chart can be deleted at once. Delete the positions below it individually',
  'and no branch in the middle of the company can be removed in one call, however the request arrives'
);

select public.admin_delete_org_position((select position_id from op where label = 'quality'));

select is(
  (select count(*)::int from public.org_positions where id = (select position_id from op where label = 'quality')),
  0,
  'a leaf deletes'
);

select is(
  (select count(*)::int from public.users where id = '19000000-0000-4000-8000-000000000020'),
  1,
  'and the person on it keeps their login, because deleting a post is not a way to delete a person'
);

-- Clearing the chart. Retargeted by 20261003120000: the cascade flag used to mean
-- "the whole company" because there was only one root to cascade from. With several
-- heads it means "this branch and everything under it", which is the useful meaning
-- -- you can retire one partner's whole side without touching the CEO's.
select public.admin_delete_org_position((select position_id from op where label = 'ceo'), true);

select is(
  (select count(*)::int from public.org_positions
    where id in (
      (select position_id from op where label = 'ceo'),
      (select position_id from op where label = 'director'),
      (select position_id from op where label = 'dispatch')
    )),
  0,
  'the cascade flag clears that head and everything under it in one call'
);

select ok(
  (select count(*)::int from public.org_positions) >= 1,
  'and leaves the other head alone, which is the whole point of allowing more than one'
);

-- Clearing the second head finishes the job.
select public.admin_delete_org_position(
  (select id from public.org_positions where parent_id is null limit 1),
  true
);

select is(
  (select count(*)::int from public.org_positions),
  0,
  'and clearing the last head leaves an empty chart'
);

select is(
  (select count(*)::int from public.users where id in (
    '19000000-0000-4000-8000-000000000020',
    '19000000-0000-4000-8000-000000000021',
    '19000000-0000-4000-8000-000000000022'
  )),
  3,
  'and no login went with it'
);

-- And a chart can be built again afterwards, because a cleared chart is a state,
-- not a tombstone.
insert into op (label, position_id)
select 'md', id
from public.admin_create_org_position(null, 'Managing Director', '10000000-0000-4000-8000-000000000001');

select is(
  (select title from public.org_positions where id = (select position_id from op where label = 'md')),
  'Managing Director',
  'a new top head can be created once the old chart is gone, which is the other half of the design'
);

-- ===========================================================================
-- I. Only an admin writes
--
-- Every role but admin, on every writer. The check is on the role and not on a list
-- of exceptions, so a QC user, a dealer login and a suspended admin all get the
-- same sentence.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select throws_ok(
  $$select public.admin_create_org_position((select position_id from op where label = 'md'), 'Underneath', null)$$,
  'P0001',
  'Only an admin can change the organization chart',
  'a QC user cannot add a post'
);

select throws_ok(
  $$select public.admin_update_org_position((select position_id from op where label = 'md'), 'Renamed')$$,
  'P0001',
  'Only an admin can change the organization chart',
  'nor rename one'
);

select throws_ok(
  $$select public.admin_move_org_position(
    (select position_id from op where label = 'md'),
    (select position_id from op where label = 'md')
  )$$,
  'P0001',
  'Only an admin can change the organization chart',
  'nor move one, and the admin check runs before the self-parent check, so a non-admin is not told about the shape of the chart'
);

select throws_ok(
  $$select public.admin_delete_org_position((select position_id from op where label = 'md'), true)$$,
  'P0001',
  'Only an admin can change the organization chart',
  'nor clear the chart, which is the one call a non-admin would most want'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '19000000-0000-4000-8000-000000000021';

select throws_ok(
  $$select public.admin_create_org_position(null, 'Own Company', null)$$,
  'P0001',
  'Only an admin can change the organization chart',
  'a dealer login cannot build a chart, and is refused before the one-root check would have let it become the head'
);

-- A disabled admin is the one caller for whom checking the role alone would let
-- the change through, so this is the assertion that says the flag is in the check.
reset role;

update public.users set is_active = false where id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_create_org_position(null, 'While Suspended', null)$$,
  'P0001',
  'Only an admin can change the organization chart',
  'a suspended admin is refused, so the test is on the role and the flag'
);

reset role;

update public.users set is_active = true where id = '10000000-0000-4000-8000-000000000001';

-- ===========================================================================
-- J. Privileges
--
-- The grants say the shape of the thing: a grant to read, and functions to write.
-- A browser holding a session can add a post only through a function that checks
-- the role, because it has no table grant to do it with.
-- ===========================================================================
select ok(
  has_table_privilege('authenticated', 'public.org_positions', 'select'),
  'authenticated can read the posts'
);

select ok(
  not has_table_privilege('authenticated', 'public.org_positions', 'insert'),
  'but cannot insert into them directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.org_positions', 'update'),
  'nor update them'
);

select ok(
  not has_table_privilege('authenticated', 'public.org_positions', 'delete'),
  'nor delete them'
);

select ok(
  not has_table_privilege('anon', 'public.org_positions', 'select'),
  'anon cannot read the posts'
);

select ok(
  has_table_privilege('authenticated', 'public.org_chart', 'select'),
  'authenticated can read the chart view'
);

select ok(
  not has_table_privilege('anon', 'public.org_chart', 'select'),
  'anon cannot read the chart view'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_create_org_position(uuid, text, uuid)', 'execute'),
  'authenticated can execute the create, because the browser is the caller'
);

select ok(
  not has_function_privilege('anon', 'public.admin_create_org_position(uuid, text, uuid)', 'execute'),
  'anon cannot execute it'
);

select ok(
  not has_function_privilege('anon', 'public.admin_delete_org_position(uuid, boolean)', 'execute'),
  'nor the delete, which is the call that would matter if anon had it'
);

select * from finish();
rollback;
