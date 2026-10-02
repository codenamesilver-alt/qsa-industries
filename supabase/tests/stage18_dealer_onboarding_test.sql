begin;
select plan(114);

-- Tests for 20260928104000_dealer_onboarding.sql.
--
-- Before this migration, onboarding a dealer was two unrelated operations in two
-- unrelated places: admin_upsert_dealer created a dealer row that was live the
-- moment it was written, and provision-user.mjs created a login from a machine
-- holding the service role key. Nothing recorded who decided a new dealer's
-- credit, so this suite is as much about the audit facts as about the happy path.
--
-- Two conventions, both from the earlier suites in this directory:
--
--   * Every function call runs impersonated, as reset role followed by
--     set local role authenticated and a request.jwt.claim.sub. These functions
--     check private.current_user_role(), which reads auth.uid(), so asserting
--     against the owner would prove nothing: the owner is never stopped by the
--     check because the check is not about the owner.
--   * Every fixture is written as the owner, in between those impersonations.
--     authenticated holds SELECT on the onboarding table and nothing else, so a
--     fixture update run as authenticated would fail on privilege rather than on
--     the fact under test.
--
-- The load bearing section is H. The first draft of the migration kept a single
-- rejection_reason column for two different acts: refusing a dealer's credit, and
-- closing an onboarding. That made a refused credit read as a closed record, so
-- declining a dealer who had already been refused on credit was refused with
-- "already declined", a later approval left the reason behind, and
-- admin_activate_dealer never looked at it at all, which produced a live dealer
-- the board reported as declined. Section H asserts the split directly, because
-- that class of bug is invisible on a happy path and only shows up in the order
-- two things happen in.
--
-- Fixed identifiers, from migrations:
--   admin          10000000-0000-4000-8000-000000000001
--   sales_manager  10000000-0000-4000-8000-000000000003
--   sales_rep Ravi 10000000-0000-4000-8000-000000000005  (Green Valley)
--   finance        22145f21-ebba-4e23-8bc5-b9650307a4ea
--   qc_staff       7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--   dealer Coastal 4637f04f-aed6-44bc-82d8-774991079d1d (public.users id)
--   dealer Green Valley 20000000-0000-4000-8000-000000000001
--   dealer Coastal      20000000-0000-4000-8000-000000000003
--
-- Dealers created here carry 30000000-... ids and login users 19000000-..., both
-- outside the seed, so nothing below can collide with a fixture.

-- ===========================================================================
-- A. The shape checks
--
-- The cheapest thing in the file to get wrong, because a GSTIN check that
-- accepts 14 characters has told a tax invoice it cannot support, and one that
-- is case sensitive rejects a value every tool in the office produces.
-- ===========================================================================
select ok(private.is_gstin('22AAAAA0000A1Z5'), 'a well formed GSTIN passes');
select ok(private.is_gstin('27AABCU9603R1Z5'), 'a second well formed GSTIN passes');

select ok(
  not private.is_gstin('22AAAAA0000A1Z'),
  'a 14 character GSTIN is refused'
);

select ok(
  not private.is_gstin('22AAAAA0000A1Z55'),
  'a 16 character GSTIN is refused'
);

select ok(
  not private.is_gstin('2AAAAA0000A1Z5'),
  'a GSTIN that does not open with two digits is refused'
);

select ok(
  not private.is_gstin('22aaaaa0000a1z5'),
  'a lower case GSTIN is refused, because a GSTIN is defined in upper case'
);

select ok(
  not private.is_gstin(null),
  'a null GSTIN is not a valid GSTIN'
);

select ok(private.is_pan('AAAAA0000A'), 'a well formed PAN passes');
select ok(not private.is_pan('AAAAA0000'), 'a 9 character PAN is refused');
select ok(not private.is_pan('AAAA00000A'), 'a PAN without the fifth letter is refused');
select ok(not private.is_pan(null), 'a null PAN is not a valid PAN');

-- ===========================================================================
-- Fixtures
--
-- Four auth users: one to attach, one to prove a non dealer cannot be a dealer
-- login, one to attach to the disabled rep dealer, and one deliberately left
-- unlinked so the decline guard can be tested on its own. Inserted as the owner,
-- and the signup trigger writes the public.users row, which is the same path a
-- real dealer signup takes.
--
-- The fourth exists because the first draft reused the third for the declined
-- record. That login was already attached to the disabled rep dealer by then, so
-- admin_link_dealer_login refused on "That login is already linked to another
-- dealer" and the decline guard never ran. The assertion still had a plausible
-- failure, and it was asserting the wrong refusal: it claimed to prove a declined
-- onboarding takes no login, and what it actually proved was that a login belongs
-- to one dealer. Both refusals are correct; only one of them is about the
-- declined record, and only that one is what this test is for.
-- ===========================================================================
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '19000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'new.dealer@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"New Dealer"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'wrong.role@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"Wrong Role"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'spare.dealer@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"Spare Dealer"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  ),
  (
    '19000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated',
    'unlinked.dealer@qsa-demo.in',
    extensions.crypt('test-password', extensions.gen_salt('bf')),
    timezone('utc', now()),
    '{"role":"dealer"}'::jsonb,
    '{"full_name":"Unlinked Dealer"}'::jsonb,
    timezone('utc', now()), timezone('utc', now())
  );

update public.users set role = 'qc_staff' where id = '19000000-0000-4000-8000-000000000002';

-- A scratch table so the assertions can name a dealer without a subquery in
-- every one of them.
create temporary table ob (label text primary key, dealer_id uuid);
grant insert, select on ob to authenticated;

-- ===========================================================================
-- B. admin_start_dealer_onboarding -- refusals
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_start_dealer_onboarding('   ', 'North')$$,
  'P0001',
  'A dealer needs a name',
  'a blank dealer name is refused'
);

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', '  ')$$,
  'P0001',
  'A dealer needs a sales region',
  'a blank region is refused, because the region report asserts nobody is Unassigned'
);

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North', 'not-a-gstin')$$,
  'P0001',
  'GSTIN must be 15 characters in the format 22AAAAA0000A1Z5',
  'a malformed GSTIN is refused at onboarding rather than at the first invoice'
);

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North', null, 'BADPAN')$$,
  'P0001',
  'PAN must be 10 characters in the format AAAAA0000A',
  'a malformed PAN is refused'
);

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North', null, null, -5)$$,
  'P0001',
  'Requested credit limit must be zero or more',
  'a negative requested credit limit is refused'
);

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North', null, null, null, null, null, 'not-an-email')$$,
  'P0001',
  'Dealer email does not look like an email address',
  'an email that is not an email address is refused'
);

-- Non admin callers. A rep, finance and qc_staff all get the same answer, which
-- is the point: the check is on the role, not on a list of exceptions to it.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North')$$,
  'P0001',
  'Only an admin can onboard a dealer',
  'a sales rep cannot open an onboarding'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North')$$,
  'P0001',
  'Only an admin can onboard a dealer',
  'finance cannot open an onboarding, even though finance owns the credit limit'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select throws_ok(
  $$select public.admin_start_dealer_onboarding('Acme Traders', 'North')$$,
  'P0001',
  'Only an admin can onboard a dealer',
  'qc_staff cannot open an onboarding'
);

-- ===========================================================================
-- C. What a successful start leaves behind
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into ob (label, dealer_id)
select 'fresh', id
from public.admin_start_dealer_onboarding(
  '  Sunrise Feeds  ',
  'North',
  ' 27aabcu9603r1z5 ',
  ' abcde1234f ',
  75000,
  'Sunrise contact',
  null,
  'orders@sunrisefeeds.in',
  '12 Market Road',
  null,
  'Ludhiana',
  'Punjab',
  '141001'
);

select is(
  (select name from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  'Sunrise Feeds',
  'the dealer name is trimmed'
);

select is(
  (select status::text from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  'inactive',
  'a new onboarding dealer does not trade the moment it is created'
);

select is(
  (select credit_limit from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  0::numeric,
  'a requested limit is not a granted one, so the dealer starts at zero'
);

select is(
  (select sales_rep_id from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  null::uuid,
  'territory is not forced at onboarding, because it is often settled after the paperwork'
);

select is(
  (select gstin from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  '27AABCU9603R1Z5',
  'a pasted lower case GSTIN is stored upper case, with the surrounding space removed'
);

select is(
  (select pan from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'ABCDE1234F',
  'the PAN is stored upper case and trimmed'
);

select is(
  (select credit_limit_requested from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  75000::numeric,
  'the request is recorded so the decision is readable after the fact'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'awaiting_credit',
  'a dealer with a GSTIN and a requested limit is waiting on a credit decision'
);

-- A dealer with no onboarding record must not appear on the board at all. It is
-- not "paper", it is an account that has been trading since before onboarding
-- existed, and reporting it as pending paperwork would be wrong.
insert into ob (label, dealer_id)
select 'legacy', id from public.dealers where id = '20000000-0000-4000-8000-000000000001';

select is(
  (select count(*) from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'legacy')),
  0::bigint,
  'a dealer with no onboarding record is absent from the board, not shown as pending'
);

-- ===========================================================================
-- D. admin_edit_dealer_onboarding
-- ===========================================================================
select lives_ok(
  $$select public.admin_edit_dealer_onboarding(
    (select dealer_id from ob where label = 'fresh'),
    '27AABCU9603R1Z5',
    'ABCDE1234F',
    90000
  )$$,
  'the request can be corrected before a decision is recorded'
);

select is(
  (select credit_limit_requested from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  90000::numeric,
  'the corrected request is the one that is stored'
);

select throws_ok(
  $$select public.admin_edit_dealer_onboarding(
    (select dealer_id from ob where label = 'fresh'),
    'nope',
    null,
    null
  )$$,
  'P0001',
  'GSTIN must be 15 characters in the format 22AAAAA0000A1Z5',
  'the edit path validates the GSTIN the same way the create path does'
);

-- ===========================================================================
-- E. admin_record_dealer_credit_decision
--
-- Refuse, then approve: the sequence that is normal in the business and was
-- impossible under the merged column.
-- ===========================================================================
select throws_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'fresh'), false, null
  )$$,
  'P0001',
  'Refusing credit needs a reason',
  'a refusal with no reason is refused, because that is the decision someone is later asked to justify'
);

-- A dealer with no requested limit cannot be approved, because approving it would
-- activate a dealer at zero and read as a decision nobody made.
insert into ob (label, dealer_id)
select 'nolimit', id
from public.admin_start_dealer_onboarding('No Limit Traders', 'North');

select throws_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'nolimit'), true, null
  )$$,
  'P0001',
  'Approving credit with no requested limit would activate a dealer at zero. Record the limit first.',
  'approving credit on a dealer who asked for nothing is refused'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'fresh'), true, null
  )$$,
  'P0001',
  'Only an admin can decide a new dealer''s credit',
  'a rep cannot approve credit'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'fresh'), false, 'Sanction check pending'
  )$$,
  'credit can be refused'
);

select is(
  (select credit_approved from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  false,
  'a refusal is recorded as an approval of false, not as the absence of a row'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'credit_refused',
  'a refused credit is a first class stage, not a closed record'
);

select is(
  (select declined_at from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  null::timestamptz,
  'refusing credit does not close the onboarding'
);

select is(
  (select decline_reason from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  null::text,
  'refusing credit writes nothing into the decline columns'
);

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'fresh'), true, 'Sanction check cleared'
  )$$,
  'a later decision replaces an earlier one, because a late credit check is normal'
);

select is(
  (select credit_approved from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  true,
  'the later decision is the one on the record'
);

select is(
  (select credit_decision_note from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'Sanction check cleared',
  'the current reason is on the record, not the superseded one'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'awaiting_login',
  'an approved dealer with no login is waiting on the login, not reported as declined'
);

select is(
  (select outstanding from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  array['provision the dealer login', 'map an active sales rep']::text[],
  'the outstanding list names the two things still missing, in flow order'
);

-- Editing is refused once a decision exists, so an approved figure can never be
-- attached to a request nobody saw.
select throws_ok(
  $$select public.admin_edit_dealer_onboarding(
    (select dealer_id from ob where label = 'fresh'),
    '27AABCU9603R1Z5',
    'ABCDE1234F',
    5000
  )$$,
  'P0001',
  'This onboarding already has a credit decision. Record a new decision rather than changing the request underneath it.',
  'the request cannot be edited after a decision, only re-decided'
);

-- ===========================================================================
-- F. admin_link_dealer_login
--
-- Granted to service_role alone, so these run as the owner impersonating the
-- caller. The privilege assertions in section J are what make that safe, and are
-- the reason p_caller_id can be trusted at all.
-- ===========================================================================
reset role;

select throws_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000005',
    (select dealer_id from ob where label = 'fresh'),
    '19000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'Only an active admin can link a dealer login',
  'a rep cannot have their id accepted as the caller'
);

select throws_ok(
  $$select public.admin_link_dealer_login(
    null,
    (select dealer_id from ob where label = 'fresh'),
    '19000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'Only an active admin can link a dealer login',
  'a null caller id is refused rather than defaulting to nobody'
);

select throws_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'fresh'),
    '19000000-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'A dealer login must carry the dealer role',
  'a user that is not a dealer cannot be a dealer login'
);

select throws_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'fresh'),
    '00000000-0000-0000-0000-000000000000'
  )$$,
  'P0001',
  'No user with that id. The auth user must exist and have a profile first.',
  'a user id that has no profile is refused'
);

-- The happy path, then a retry of the same call, which is what an edge function
-- does after a network failure.
select lives_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'fresh'),
    '19000000-0000-4000-8000-000000000001'
  )$$,
  'an admin can link a dealer login'
);

select is(
  (select dealer_id from public.users where id = '19000000-0000-4000-8000-000000000001'),
  (select dealer_id from ob where label = 'fresh'),
  'the login is pointed at the dealer being onboarded'
);

select is(
  (select login_user_id from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  '19000000-0000-4000-8000-000000000001'::uuid,
  'the onboarding record names the login it was given'
);

select ok(
  (select login_provisioned_at is not null from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'provisioning is timestamped, so "when was this account created" has an answer'
);

select lives_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'fresh'),
    '19000000-0000-4000-8000-000000000001'
  )$$,
  're-linking the same user is idempotent, so a retry after a timeout succeeds'
);

select throws_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'nolimit'),
    '19000000-0000-4000-8000-000000000001'
  )$$,
  'P0001',
  'That login is already linked to another dealer. Change it on the user itself.',
  'one login cannot be moved between dealers by the onboarding path'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'awaiting_activation',
  'approved and linked but still unassigned: the only thing left is a rep mapping'
);

-- ===========================================================================
-- G. admin_activate_dealer
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'fresh'))$$,
  'P0001',
  'Only an admin can activate a new dealer',
  'a rep cannot activate a dealer'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- Preconditions on separate dealers, so each refusal is about the one thing under
-- test rather than about whichever check happens to run first.
insert into ob (label, dealer_id)
select 'no_credit', id
from public.admin_start_dealer_onboarding('No Credit Yet', 'North', '29AAAAA0000A1Z5', null, 10000);

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'no_credit'))$$,
  'P0001',
  'Record a credit decision before activating',
  'a dealer with no credit decision cannot go live'
);

insert into ob (label, dealer_id)
select 'refused', id
from public.admin_start_dealer_onboarding('Credit Refused Ltd', 'North', '29AAAAA0000A1Z6', null, 10000);

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'refused'), false, 'Bank reference declined'
  )$$,
  'credit can be refused'
);

insert into ob (label, dealer_id)
select 'approved', id
from public.admin_start_dealer_onboarding('Approved No Login', 'North', '29AAAAA0000A1Z7', null, 20000);

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'approved'), true, null
  )$$,
  'credit can be approved'
);

select is(
  (select login_user_id from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'approved')),
  null::uuid,
  'the approved dealer genuinely has no login yet'
);

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'approved'))$$,
  'P0001',
  'Provision the dealer login before activating',
  'a dealer nobody can log in as does not go live, even with credit approved'
);

-- Now the fully ready dealer: mapped to an active rep.
reset role;
update public.dealers
   set sales_rep_id = '10000000-0000-4000-8000-000000000005'
 where id = (select dealer_id from ob where label = 'fresh');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'fresh'))$$,
  'an approved, logged in, rep mapped dealer activates'
);

select is(
  (select status::text from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  'active',
  'the dealer trades after activation'
);

select is(
  (select credit_limit from public.dealers where id = (select dealer_id from ob where label = 'fresh')),
  90000::numeric,
  'the approved requested limit becomes the dealer credit limit at activation'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'live',
  'a trading dealer reads as live'
);

select is(
  (select outstanding from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  null::text[],
  'a live dealer is not waiting on anything'
);

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'fresh'))$$,
  'P0001',
  'This dealer is already active',
  'a dealer cannot be activated twice'
);

-- The precondition is on the rep being an active rep, not merely a rep. An
-- account mapped to a disabled rep cannot be ordered for, and the portal would
-- show it as live with no way to place an order.
reset role;
insert into ob (label, dealer_id)
select 'dead_rep', id
from public.admin_start_dealer_onboarding('Disabled Rep Ltd', 'North', '29AAAAA0000A1Z8', null, 30000);

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'dead_rep'), true, null
  )$$,
  'credit can be approved on the disabled rep dealer'
);

update public.dealers
   set sales_rep_id = '10000000-0000-4000-8000-000000000005'
 where id = (select dealer_id from ob where label = 'dead_rep');

-- The login is provisioned first, deliberately. admin_activate_dealer checks the
-- login before the rep, so without a login this dealer would be stopped by the
-- login check and the rep check would never run, which would make the assertion
-- below pass for the wrong reason.
select public.admin_link_dealer_login(
  '10000000-0000-4000-8000-000000000001',
  (select dealer_id from ob where label = 'dead_rep'),
  '19000000-0000-4000-8000-000000000003'
);

update public.users set is_active = false where id = '10000000-0000-4000-8000-000000000005';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'dead_rep'))$$,
  'P0001',
  'The mapped sales rep is not an active sales rep',
  'a dealer mapped to a disabled rep does not go live'
);

select is(
  (select is_active from public.users where id = '10000000-0000-4000-8000-000000000005'),
  false,
  'the rep really was disabled for the assertion above'
);

reset role;
update public.users set is_active = true where id = '10000000-0000-4000-8000-000000000005';

-- ===========================================================================
-- H. admin_decline_dealer_onboarding, and the split from a credit refusal
--
-- Every assertion here is a consequence of declined_at being separate from
-- credit_decision_note. With them merged, the first one below was impossible: the
-- refusal had filled the reason slot, so declining a dealer who walked away after
-- a bad reference was refused with "already declined".
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.admin_decline_dealer_onboarding((select dealer_id from ob where label = 'refused'), 'changed my mind')$$,
  'P0001',
  'Only an admin can decline a dealer onboarding',
  'a rep cannot decline an onboarding'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_decline_dealer_onboarding(
    (select dealer_id from ob where label = 'refused'), 'Walked away after the reference came back'
  )$$,
  'a dealer refused on credit can then be declined, because the two are separate facts'
);

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'refused')),
  'declined',
  'a closed onboarding reads as declined'
);

select is(
  (select declined_by from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'refused')),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'the decline records who closed it'
);

select is(
  (select credit_decision_note from public.dealer_onboardings where dealer_id = (select dealer_id from ob where label = 'refused')),
  'Bank reference declined',
  'the credit refusal survives the decline, as its own fact'
);

select throws_ok(
  $$select public.admin_decline_dealer_onboarding((select dealer_id from ob where label = 'refused'), 'again')$$,
  'P0001',
  'This onboarding has already been declined',
  'a closed onboarding cannot be closed twice'
);

select throws_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'refused'), true, 'changed my mind'
  )$$,
  'P0001',
  'This onboarding has been declined, so the record is closed and cannot carry a new decision.',
  'a declined onboarding cannot be re-decided'
);

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'refused'))$$,
  'P0001',
  'This onboarding has been declined, so the dealer cannot be activated',
  'a declined onboarding cannot be activated'
);

reset role;

-- A genuine dealer role user this time, and one attached to nobody, so the
-- decline guard is the check that fires rather than either the role check ahead
-- of it or the already-linked check behind it.
select throws_ok(
  $$select public.admin_link_dealer_login(
    '10000000-0000-4000-8000-000000000001',
    (select dealer_id from ob where label = 'refused'),
    '19000000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'This onboarding has been declined, so there is nothing to attach a login to',
  'a login cannot be attached to a declined onboarding'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.admin_decline_dealer_onboarding((select dealer_id from ob where label = 'fresh'), 'too late')$$,
  'P0001',
  'This dealer is already live. Set the account status on the dealer master instead.',
  'a live dealer cannot be declined, because a closure is not a deactivation'
);

select throws_ok(
  $$select public.admin_decline_dealer_onboarding((select dealer_id from ob where label = 'no_credit'), '')$$,
  'P0001',
  'Declining an onboarding needs a reason',
  'a decline with no reason is refused'
);

-- The exact combination that produced a live dealer the board called declined
-- under the merged column: everything ready to activate, then a decline.
reset role;
insert into ob (label, dealer_id)
select 'decline_last', id
from public.admin_start_dealer_onboarding('Ready Then Walked', 'North', '29AAAAA0000A1Z9', null, 40000);

select lives_ok(
  $$select public.admin_record_dealer_credit_decision(
    (select dealer_id from ob where label = 'decline_last'), true, null
  )$$,
  'credit is approved before the decline'
);

update public.dealers
   set sales_rep_id = '10000000-0000-4000-8000-000000000005'
 where id = (select dealer_id from ob where label = 'decline_last');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.admin_decline_dealer_onboarding(
    (select dealer_id from ob where label = 'decline_last'), 'Board decision after approval'
  )$$,
  'an otherwise ready dealer can be declined'
);

select throws_ok(
  $$select public.admin_activate_dealer((select dealer_id from ob where label = 'decline_last'))$$,
  'P0001',
  'This onboarding has been declined, so the dealer cannot be activated',
  'approval and a rep mapping do not survive a later decline'
);

select is(
  (select status::text from public.dealers where id = (select dealer_id from ob where label = 'decline_last')),
  'inactive',
  'a declined dealer never becomes active'
);

-- The board prefers the closure. Declined is checked before the live branch
-- because a declined row can also satisfy every condition of an open stage, and
-- reporting it as "awaiting activation" would be true of the columns and false of
-- the business.
select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'decline_last')),
  'declined',
  'a declined record that satisfies every open stage still reads as declined'
);

-- A live dealer who is later deactivated on the dealer master is not onboarding.
reset role;
update public.dealers set status = 'inactive' where id = (select dealer_id from ob where label = 'fresh');
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select is(
  (select stage from public.dealer_onboarding_board where dealer_id = (select dealer_id from ob where label = 'fresh')),
  'deactivated',
  'a dealer deactivated after onboarding is still a completed onboarding, not a pending one'
);

reset role;
update public.dealers set status = 'active' where id = (select dealer_id from ob where label = 'fresh');

-- ===========================================================================
-- I. The wholeness constraints
--
-- The last line of defence. Every function above writes the three parts of a fact
-- together, so these should be unreachable through the API. They exist so a
-- future writer who updates a subset fails at the database rather than producing
-- a row the board has to guess about. Run as the owner, since authenticated
-- cannot write this table at all.
-- ===========================================================================
select throws_ok(
  $$insert into public.dealer_onboardings (dealer_id, declined_at)
    values ('20000000-0000-4000-8000-000000000003', now())$$,
  '23514',
  null,
  'a decline with no decider and no reason cannot be written'
);

select throws_ok(
  $$insert into public.dealer_onboardings (dealer_id, credit_approved)
    values ('20000000-0000-4000-8000-000000000003', true)$$,
  '23514',
  null,
  'a credit decision with no decider and no timestamp cannot be written'
);

select throws_ok(
  $$update public.dealer_onboardings
      set declined_at = null, declined_by = null
    where dealer_id = (select dealer_id from ob where label = 'decline_last')$$,
  '23514',
  null,
  'a decline cannot be half erased, leaving a reason with no closure'
);

select throws_ok(
  $$update public.dealer_onboardings
      set activated_at = now(),
          activated_by = '10000000-0000-4000-8000-000000000001'
    where dealer_id = (select dealer_id from ob where label = 'decline_last')$$,
  '23514',
  null,
  'a record cannot be both declined and activated'
);

-- ===========================================================================
-- J. Exposure
--
-- The whole point of keeping login provisioning behind an edge function is that
-- p_caller_id is a claim by trusted code rather than by a browser. That only
-- holds while authenticated cannot execute the function, so it is asserted
-- directly rather than inferred from the happy path.
-- ===========================================================================
select ok(
  not has_function_privilege('authenticated', 'public.admin_link_dealer_login(uuid, uuid, uuid)', 'execute'),
  'authenticated cannot execute admin_link_dealer_login'
);

select ok(
  has_function_privilege('service_role', 'public.admin_link_dealer_login(uuid, uuid, uuid)', 'execute'),
  'the edge function is able to execute admin_link_dealer_login'
);

select ok(
  not has_function_privilege('anon', 'public.admin_link_dealer_login(uuid, uuid, uuid)', 'execute'),
  'anon cannot execute admin_link_dealer_login'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_activate_dealer(uuid)', 'execute'),
  'authenticated can execute the admin callable onboarding functions'
);

select ok(
  has_table_privilege('authenticated', 'public.dealer_onboardings', 'select'),
  'authenticated can read the onboarding table, with RLS deciding which rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.dealer_onboardings', 'insert'),
  'authenticated cannot insert an onboarding row directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.dealer_onboardings', 'update'),
  'authenticated cannot update an onboarding row directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.dealer_onboardings', 'delete'),
  'authenticated cannot delete an onboarding row directly'
);

select ok(
  not has_table_privilege('anon', 'public.dealer_onboardings', 'select'),
  'anon cannot read the onboarding table'
);

select ok(
  has_table_privilege('authenticated', 'public.dealer_onboarding_board', 'select'),
  'authenticated can read the onboarding board'
);

select ok(
  not has_table_privilege('anon', 'public.dealer_onboarding_board', 'select'),
  'anon cannot read the onboarding board'
);

set local role anon;

select throws_ok(
  $$select * from public.dealer_onboarding_board$$,
  '42501',
  null,
  'anon cannot read the onboarding board through the data api'
);

select throws_ok(
  $$select * from public.dealer_onboardings$$,
  '42501',
  null,
  'anon cannot read the onboarding table through the data api'
);

-- Every non admin role sees nothing, on both objects. The board is
-- security_invoker, so if the underlying policy were ever widened the view would
-- follow it, which is why the scope is asserted per role rather than assumed
-- from the grant.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';

select is(
  (select count(*) from public.dealer_onboarding_board),
  0::bigint,
  'a sales rep sees no onboarding records'
);

select is(
  (select count(*) from public.dealer_onboardings),
  0::bigint,
  'a sales rep sees no onboarding rows'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';

select is(
  (select count(*) from public.dealer_onboarding_board),
  0::bigint,
  'a sales manager sees no onboarding records'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22145f21-ebba-4e23-8bc5-b9650307a4ea';

select is(
  (select count(*) from public.dealer_onboarding_board),
  0::bigint,
  'finance sees no onboarding records, even though finance owns the credit limit'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';

select is(
  (select count(*) from public.dealer_onboarding_board),
  0::bigint,
  'qc_staff see no onboarding records'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select ok(
  (select count(*) from public.dealer_onboarding_board) > 0,
  'an admin does see the onboarding board'
);

select is(
  (select count(*) from public.dealer_onboarding_board),
  (select count(*) from public.dealer_onboardings),
  'every onboarding row is on the board, and the board invents none'
);

-- A dealer login, which is the person whose onboarding record matters most and
-- who must still not read it.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';

select is(
  (select count(*) from public.dealer_onboarding_board),
  0::bigint,
  'a dealer sees no onboarding records, including their own'
);

select * from finish();
rollback;
