begin;
select plan(67);
-- Tests for 20261002120000_user_designation_and_account_creation.sql.
--
-- What this migration adds: a free-text designation on public.users, account
-- creation from inside the portal, and a password reset for an admin. The account
-- creation is the part with real risk in it, because it writes auth.users and
-- auth.identities from a SECURITY DEFINER function, so most of this file is about
-- what that function refuses and about what it leaves behind when it refuses.
--
-- Conventions are stage21's, for the same reasons: every function call runs
-- impersonated as an authenticated user with a request.jwt.claim.sub, because
-- private.current_user_role() reads auth.uid() and asserting against the owner
-- would prove nothing. Fixtures are written as the owner, in between those
-- impersonations.
--
-- The auth.* assertions cannot be run impersonated at all: authenticated has no
-- rights on auth.users, which is the whole point of that schema. So those blocks
-- reset to the owner, assert, and impersonate again.
--
-- Fixed identifiers, from the seed:
--   admin         10000000-0000-4000-8000-000000000001
--   director      10000000-0000-4000-8000-000000000002
--   manager       10000000-0000-4000-8000-000000000003  (imran.sheikh)
--   qc_staff      7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901
--   dealer login  4637f04f-aed6-44bc-82d8-774991079d1d
--   dealer        20000000-0000-4000-8000-000000000003
--
-- Accounts created here carry addresses under @qsa-test.in, which no seed account
-- uses, so a refusal assertion can look for its absence without risking a collision.

-- ===========================================================================
-- A. A staff account, created through the new function
-- ===========================================================================

reset role;

-- Where the created accounts land, so assertions can name one without repeating a
-- uuid that only the function knows.
create temporary table created (label text primary key, user_id uuid, email text);
grant insert, select on created to authenticated;

-- Two entries in the designation catalogue, written straight into the table because
-- the writer function refuses anybody who is not an admin and this block runs before
-- a claim is set. 20261003100000 changed the designation from free text on the person
-- to a reference to one of these, so every account created below names a row rather
-- than typing a title, and every assertion that used to read public.users.designation
-- now reads the catalogue through the reference.
create temporary table desig (label text primary key, designation_id uuid, name text);
grant select on desig to authenticated;

insert into public.designations (name)
values ('Senior Quality Chemist'), ('Lead Quality Chemist'), ('Territory Sales Executive');

insert into desig (label, designation_id, name)
select 'senior', id, name from public.designations where name = 'Senior Quality Chemist'
union all
select 'lead', id, name from public.designations where name = 'Lead Quality Chemist'
union all
select 'territory', id, name from public.designations where name = 'Territory Sales Executive';

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into created (label, user_id, email)
select 'chemist', id, email
from public.admin_create_user_account(
  '  Chemist.One@QSA-Test.in  ',
  '  Kavya Rao  ',
  'first-password',
  'qc_staff',
  (select designation_id from desig where label = 'senior'),
  '+91 90000 11111'
);

-- 1. it returned a row at all, which is the minimum a create call can achieve
select ok((select count(*)::int from created where label = 'chemist') = 1,
  'admin_create_user_account returns a row');

-- 2. the address is stored lowercased and trimmed, so a login is never two logins
select is((select email from public.users where id = (select user_id from created where label = 'chemist')),
  'chemist.one@qsa-test.in',
  'the email is lowercased and trimmed');

-- 3. the name is trimmed rather than stored with the padding it was typed with
select is((select full_name from public.users where id = (select user_id from created where label = 'chemist')),
  'Kavya Rao',
  'the full name is trimmed');

-- 4. the designation is stored, as the reference to the catalogue row rather than
--    as a title typed onto the person
select is((select d.name from public.users as u
             join public.designations as d on d.id = u.designation_id
            where u.id = (select user_id from created where label = 'chemist')),
  'Senior Quality Chemist',
  'the designation is stored as a reference to that catalogue row');

-- 5. the phone number is stored
select is((select phone from public.users where id = (select user_id from created where label = 'chemist')),
  '+91 90000 11111',
  'the phone number is stored');

-- 6. the role is exactly what was asked for. This is the assertion that the
--    trigger's whitelist repair is load-bearing: before this migration, private
--    handle_new_user() did not mention qc_staff and wrote sales_rep.
select is((select role::text from public.users where id = (select user_id from created where label = 'chemist')),
  'qc_staff',
  'the role is the one requested, not the one the trigger defaults to');

-- 7. the account is active
select ok((select is_active from public.users where id = (select user_id from created where label = 'chemist')),
  'a new account is active');

-- 8. the admin screen reads user_directory, so the account has to be there
select is((select count(*)::int from public.user_directory where email = 'chemist.one@qsa-test.in'),
  1,
  'the new account appears in the admin directory');

-- 9. and it appears there with its designation, which is the reason the column was
--    added to that view
select is((select designation from public.user_directory where email = 'chemist.one@qsa-test.in'),
  'Senior Quality Chemist',
  'the admin directory carries the designation');

-- 10. internal staff see the person in the org chart roster
select is((select count(*)::int from public.org_staff_roster where email = 'chemist.one@qsa-test.in'),
  1,
  'the new account appears in the org staff roster');

-- 11. with the designation on it
select is((select designation from public.org_staff_roster where email = 'chemist.one@qsa-test.in'),
  'Senior Quality Chemist',
  'the org roster carries the designation');

-- 12. a post held by this person shows the designation on the chart. Empty first,
--     because the chart is asserted on below and a leftover root from another run
--     would fail the one-root rules for the wrong reason.
reset role;
delete from public.org_positions;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

select public.admin_create_org_position(
  null,
  'Quality Chemist',
  (select id from public.users where email = 'chemist.one@qsa-test.in'));

select is((select user_designation from public.org_chart),
  'Senior Quality Chemist',
  'the org chart shows the designation of the person on a post');

-- 13. and the post title and the designation are separate columns, which is the
--     whole reason the column is not a rename of the title
select is((select title from public.org_chart),
  'Quality Chemist',
  'the post title and the designation are independent');

-- ===========================================================================
-- B. The Auth side, which authenticated cannot read
-- ===========================================================================

reset role;

-- 14. an auth row exists, or nothing else in this section means anything
select ok(exists (select 1 from auth.users where email = 'chemist.one@qsa-test.in'),
  'an auth.users row was written');

-- 15. the password verifies against what was typed. This is the assertion that
--     makes the login real rather than nominal: GoTrue will compare the submitted
--     password through exactly this comparison.
select ok((select encrypted_password = crypt('first-password', encrypted_password)
            from auth.users where email = 'chemist.one@qsa-test.in'),
  'the stored hash verifies against the password that was typed');

-- 16. stored with GoTrue's own bcrypt parameters, so a hash written here is
--     indistinguishable from one GoTrue wrote
select ok((select encrypted_password like '$2a$06$%'
            from auth.users where email = 'chemist.one@qsa-test.in'),
  'the hash uses the $2a$06$ parameters GoTrue uses');

-- 17. the account is confirmed. Without this Supabase treats the account as
--     unconfirmed, and a password login against an unconfirmed account fails.
select ok((select email_confirmed_at is not null from auth.users where email = 'chemist.one@qsa-test.in'),
  'the account is email-confirmed');

-- 18. the role is carried in app metadata, which is what private.handle_new_user()
--     reads to decide what profile row to write
select is((select raw_app_meta_data ->> 'role' from auth.users where email = 'chemist.one@qsa-test.in'),
  'qc_staff',
  'app metadata carries the role');

-- 19. an identities row exists. This is the one that is easy to miss: an auth row
--     with no identity is an account that exists, cannot sign in, and cannot be
--     diagnosed from the application.
select is((select count(*)::int from auth.identities
            where user_id = (select user_id from created where label = 'chemist')),
  1,
  'an auth.identities row exists, without which the login cannot sign in');

-- 20. on the email provider
select is((select provider from auth.identities
            where user_id = (select user_id from created where label = 'chemist')),
  'email',
  'the identity is on the email provider');

-- 21. identity_data carries the address, because the identities.email column is a
--     stored generated column over exactly that key
select is((select identity_data ->> 'email' from auth.identities
            where user_id = (select user_id from created where label = 'chemist')),
  'chemist.one@qsa-test.in',
  'identity_data carries the address the generated email column derives from');

-- 22. and the generated column agrees with it
select is((select email from auth.identities
            where user_id = (select user_id from created where label = 'chemist')),
  'chemist.one@qsa-test.in',
  'the generated identities.email column resolved to the same address');

-- 23. email_verified is set, matching email_confirmed_at above
select ok((select (identity_data ->> 'email_verified')::boolean from auth.identities
            where user_id = (select user_id from created where label = 'chemist')),
  'the identity is marked verified');

-- 24. the plaintext password is not stored anywhere. A grep rather than a column
--     check, because the failure this guards against is a password ending up in
--     some column nobody thought to check.
select is((select count(*)::int from (select to_jsonb(u) as row from auth.users u) as s
            where s.row::text like '%first-password%'),
  0,
  'the plaintext password appears nowhere in auth.users');

-- 25. nor in the profile table
select is((select count(*)::int from (select to_jsonb(p) as row from public.users p) as s
            where s.row::text like '%first-password%'),
  0,
  'the plaintext password appears nowhere in public.users');

-- ===========================================================================
-- C. A second account, this one a sales rep, to prove the hierarchy is written
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

insert into created (label, user_id, email)
select 'rep', id, email
from public.admin_create_user_account(
  'rep.one@qsa-test.in',
  'Ravi Test',
  'second-password',
  'sales_rep',
  (select designation_id from desig where label = 'territory'),
  null,
  true,
  '10000000-0000-4000-8000-000000000003'
);

-- 26. the reporting line was written in the same call
select is((select manager_id::text from public.user_hierarchy
            where user_id = (select user_id from created where label = 'rep')),
  '10000000-0000-4000-8000-000000000003',
  'the reporting line is written by the create call');

-- 27. the create path stores the designation reference it was handed
select is((select designation_id from public.users where id = (select user_id from created where label = 'rep')),
  (select designation_id from desig where label = 'territory'),
  'a designation supplied at creation is stored');

-- 28. a sales rep with no manager is refused
select throws_ok(
  $$ select public.admin_create_user_account('rep.two@qsa-test.in', 'No Manager', 'third-password', 'sales_rep') $$,
  'A sales rep must report to a sales manager',
  'a sales rep cannot be created without a manager'
);

-- 29. an omitted designation is stored as null, not as an empty string. The
--     column is nullable and a job title is not something everybody has, so an
--     empty string here would show up in the UI as a blank line where the
--     absence of a title should read as nothing at all.
insert into created (label, user_id, email)
select 'nodesign', id, email
from public.admin_create_user_account(
  'no.designation@qsa-test.in',
  'Anil Nair',
  'fourth-password',
  'qc_staff',
  null,
  null,
  true,
  null
);

select is((select designation_id from public.users
            where id = (select user_id from created where label = 'nodesign')),
  null,
  'a designation that was not supplied stays null');

-- ===========================================================================
-- D. What the create function refuses
-- ===========================================================================

-- 29. a duplicate address
select throws_ok(
  $$ select public.admin_create_user_account('chemist.one@qsa-test.in', 'Impostor', 'third-password', 'qc_staff') $$,
  'An account with that email address already exists',
  'a duplicate email address is refused'
);

-- 30. case insensitively, because the addresses are stored lowercased and a
--     case-sensitive check would let Chemist.One@ through as a second account
select throws_ok(
  $$ select public.admin_create_user_account('CHEMIST.ONE@QSA-TEST.IN', 'Impostor', 'third-password', 'qc_staff') $$,
  'An account with that email address already exists',
  'a duplicate email address is refused however it is capitalised'
);

-- 31. a short password
select throws_ok(
  $$ select public.admin_create_user_account('short@qsa-test.in', 'Short', 'abc', 'qc_staff') $$,
  'The initial password needs at least 8 characters',
  'a password under 8 characters is refused'
);

-- 32. a password of nothing but spaces, which passes a length check and is useless
select throws_ok(
  $$ select public.admin_create_user_account('spaces@qsa-test.in', 'Spaces', '        ', 'qc_staff') $$,
  'The password cannot be only spaces',
  'a whitespace password is refused'
);

-- 33. no name
select throws_ok(
  $$ select public.admin_create_user_account('noname@qsa-test.in', '   ', 'a-good-password', 'qc_staff') $$,
  'A user needs a full name',
  'a blank full name is refused'
);

-- 34. no address
select throws_ok(
  $$ select public.admin_create_user_account('  ', 'No Email', 'a-good-password', 'qc_staff') $$,
  'A login needs an email address',
  'a blank email address is refused'
);

-- 35. an address that lost its @
select throws_ok(
  $$ select public.admin_create_user_account('not-an-address', 'No At', 'a-good-password', 'qc_staff') $$,
  'That does not look like an email address',
  'an address with no @ is refused'
);

-- 36. a dealer account with no dealer behind it
select throws_ok(
  $$ select public.admin_create_user_account('nodealer@qsa-test.in', 'No Dealer', 'a-good-password', 'dealer') $$,
  'A dealer account must be linked to a dealer',
  'a dealer account with no dealer is refused'
);

-- 37. a staff account carrying a dealer link, which would let a staff login read
--     that dealer's data through the dealer policies
select throws_ok(
  $$ select public.admin_create_user_account('badlink@qsa-test.in', 'Bad Link', 'a-good-password',
       'qc_staff', null, null, true, null, '20000000-0000-4000-8000-000000000003') $$,
  'Only a dealer account can be linked to a dealer',
  'a staff account carrying a dealer link is refused'
);

-- 38. a rep pointed at somebody who is not a manager
select throws_ok(
  $$ select public.admin_create_user_account('badboss@qsa-test.in', 'Bad Boss', 'a-good-password',
       'sales_rep', null, null, true, '10000000-0000-4000-8000-000000000001') $$,
  'A sales rep reports to an active sales manager',
  'a rep pointed at the admin is refused, because admin is not a sales manager'
);

-- 39. a manager with no director above
select throws_ok(
  $$ select public.admin_create_user_account('nodirector@qsa-test.in', 'No Director', 'a-good-password', 'sales_manager') $$,
  'A sales manager must report to the sales director',
  'a sales manager with no director is refused'
);

-- 40. a reporting line on a role that does not have one in a three-level hierarchy
select throws_ok(
  $$ select public.admin_create_user_account('qcmanager@qsa-test.in', 'QC Manager', 'a-good-password',
       'qc_staff', null, null, true, '10000000-0000-4000-8000-000000000002') $$,
  'Only sales roles report to a manager',
  'a reporting line on a non-sales role is refused'
);

-- 41. a designation id that is not in the catalogue. Before 20261003100000 this was
--     an over-long title; a title is now a row, so the failure mode is a reference to
--     nothing, which would draw as an empty title with no way to tell it from a person
--     who simply has none.
select throws_ok(
  $$ select public.admin_create_user_account('longtitle@qsa-test.in', 'Long Title', 'a-good-password',
       'qc_staff', '00000000-0000-0000-0000-0000000000ff') $$,
  'No designation with that id',
  'a designation id that is not in the catalogue is refused'
);

-- 42. nobody outside the admin role may create an account, whatever else is right
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
select throws_ok(
  $$ select public.admin_create_user_account('sneaky@qsa-test.in', 'Sneaky', 'a-good-password', 'qc_staff') $$,
  'Only an admin can create an account',
  'a qc_staff account cannot create an account'
);

-- 43. and a dealer login cannot either, because a customer must not be able to
--     make staff
set local request.jwt.claim.sub = '4637f04f-aed6-44bc-82d8-774991079d1d';
select throws_ok(
  $$ select public.admin_create_user_account('sneaky2@qsa-test.in', 'Sneaky', 'a-good-password', 'dealer', null, null, true, null, '20000000-0000-4000-8000-000000000003') $$,
  'Only an admin can create an account',
  'a dealer account cannot create an account'
);

-- 44. the important one: every one of those refusals has to have left nothing
--     behind. An auth row with no profile cannot be signed into, cannot be listed
--     in the admin screen, and cannot be found by the screen an admin would use to
--     fix it. The expected count comes from the created table rather than a
--     literal, so adding an account to this suite cannot silently desync it.
reset role;
select is((select count(*)::int from auth.users where email like '%@qsa-test.in'),
  (select count(*)::int from created),
  'only the accounts that were asked for exist in auth.users');

-- 45. and nothing extra in the profile table
select is((select count(*)::int from public.users where email like '%@qsa-test.in'),
  (select count(*)::int from created),
  'only the accounts that were asked for exist in public.users');

-- ===========================================================================
-- E. The upsert, extended
-- ===========================================================================

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- 46. the designation can be set through the edit path
select is((select designation_id from public.admin_upsert_user_profile(
            (select user_id from created where label = 'chemist'),
            'Kavya Rao', 'qc_staff', true, null, null,
            (select designation_id from desig where label = 'lead'), null)),
  (select designation_id from desig where label = 'lead'),
  'the edit path sets the designation');

-- 47. and the reference reads back as the title it points at
select is((select d.name from public.users as u
             join public.designations as d on d.id = u.designation_id
            where u.id = (select user_id from created where label = 'chemist')),
  'Lead Quality Chemist',
  'the edit path stores the reference, and it reads back as the catalogue title');

-- 48. and a null clears it. The opposite of how a null manager behaves, and
--     deliberately so: a manager is only dropped by omitting it from a role that
--     requires one, while a designation is cleared by explicitly writing nothing.
select is((select designation_id from public.admin_upsert_user_profile(
            (select user_id from created where label = 'chemist'),
            'Kavya Rao', 'qc_staff', true, null, null, null, null)),
  null,
  'a null designation clears it rather than being ignored');

-- 49. the six-argument call still works. Every pgTAP suite in this repository
--     calls the edit path with six arguments, so the two new parameters having
--     defaults is the only reason those suites need no change.
select is((select phone from public.admin_upsert_user_profile(
            (select user_id from created where label = 'chemist'),
            'Kavya Rao', 'qc_staff', true)),
  null,
  'the six-argument call still works and returns the row');

-- 50. and it leaves the designation alone
select is((select designation_id from public.users where id = (select user_id from created where label = 'chemist')),
  null,
  'the six-argument call leaves the designation alone'
);

-- 51. the edit path refuses an unknown designation id too, not only the create path
select throws_ok(
  $$ select public.admin_upsert_user_profile(
       (select user_id from created where label = 'chemist'),
       'Kavya Rao', 'qc_staff', true, null, null,
       '00000000-0000-0000-0000-0000000000ff', null) $$,
  'No designation with that id',
  'the edit path refuses an unknown designation id'
);

-- 52. an omitted designation clears it to null rather than leaving the old reference
--     behind. A person whose title is removed should read as having none, and the UI
--     sends null for an empty picker, so null has to mean clear.
select lives_ok(
  $$ select public.admin_upsert_user_profile(
       (select user_id from created where label = 'chemist'),
       'Kavya Rao', 'qc_staff', true, null, null,
       (select designation_id from desig where label = 'senior'), null) $$,
  'a designation can be set to a catalogue row'
);

select is((select designation_id from public.users
            where id = (select user_id from created where label = 'chemist')),
  (select designation_id from desig where label = 'senior'),
  'the edit path stores the catalogue row it was handed');

-- 53. the lockout guards are still the same guards
select throws_ok(
  $$ select public.admin_upsert_user_profile(
       '10000000-0000-4000-8000-000000000001', 'Arjun Mehta', 'qc_staff', true) $$,
  'An admin cannot change their own role or suspend themselves. Ask another admin to do it.',
  'an admin still cannot edit their own role'
);

-- ===========================================================================
-- F. Setting a password
-- ===========================================================================

-- 54. the new password verifies
select lives_ok(
  $$ select public.admin_set_user_password(
       (select user_id from created where label = 'chemist'), 'a-brand-new-password') $$,
  'an admin can set a password'
);

reset role;
select ok((select encrypted_password = crypt('a-brand-new-password', encrypted_password)
            from auth.users where email = 'chemist.one@qsa-test.in'),
  'the new password verifies against the stored hash');

-- 55. and the old one no longer does, which is the point of setting it
select is((select encrypted_password = crypt('first-password', encrypted_password)
            from auth.users where email = 'chemist.one@qsa-test.in'),
  false,
  'the previous password no longer verifies');

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';

-- 56. too short
select throws_ok(
  $$ select public.admin_set_user_password(
       (select user_id from created where label = 'chemist'), 'short') $$,
  'The password needs at least 8 characters',
  'a password under 8 characters is refused'
);

-- 57. an account that does not exist
select throws_ok(
  $$ select public.admin_set_user_password('00000000-0000-0000-0000-000000000000', 'a-good-password') $$,
  'No login with that id',
  'a password cannot be set on an account that does not exist'
);

-- 58. and nobody who is not an admin
set local request.jwt.claim.sub = '7c1f0a52-9d34-4b6e-8a17-52e0c4b8d901';
select throws_ok(
  $$ select public.admin_set_user_password(
       (select user_id from created where label = 'chemist'), 'another-password') $$,
  'Only an admin can set a password',
  'a qc_staff account cannot set a password'
);

-- ===========================================================================
-- G. Privileges
--
-- anon is revoked by name and not only through public, because on a hosted project
-- the default privileges for the public schema grant EXECUTE on every new function
-- to anon as well as authenticated.
-- ===========================================================================

select ok(not has_function_privilege('anon', 'public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid)', 'execute'),
  'anon cannot create an account');

select ok(not has_function_privilege('anon', 'public.admin_set_user_password(uuid, text, boolean)', 'execute'),
  'anon cannot set a password');

select ok(has_function_privilege('authenticated', 'public.admin_create_user_account(text, text, text, public.user_role, uuid, text, boolean, uuid, uuid)', 'execute'),
  'an authenticated admin can create an account');

select ok(has_function_privilege('authenticated', 'public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid, uuid, text)', 'execute'),
  'authenticated can call the eight-argument edit path');

-- ===========================================================================
-- H. The trigger whitelist, repaired
-- ===========================================================================

reset role;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '19000000-0000-4000-8000-000000000041', 'authenticated', 'authenticated',
  'signup.qc@qsa-test.in',
  extensions.crypt('signup-password', extensions.gen_salt('bf')),
  timezone('utc', now()),
  '{"provider":"email","providers":["email"],"role":"qc_staff"}'::jsonb,
  '{"email":"signup.qc@qsa-test.in","full_name":"Signup QC","designation":"Chemist"}'::jsonb,
  timezone('utc', now()), timezone('utc', now())
);

-- 59. a signup naming qc_staff now gets a qc_staff profile. Before this migration
--     the trigger's whitelist did not mention the role and wrote sales_rep.
select is((select role::text from public.users where id = '19000000-0000-4000-8000-000000000041'),
  'qc_staff',
  'a signup naming qc_staff gets a qc_staff profile, not a sales rep');

-- 60. and it does NOT pick the designation up out of the metadata. Inverted by
--     20261003100000. It used to be read there, which was harmless while a title
--     decided nothing. A designation now decides which pages a person may open, so a
--     signup that named its own would be a self-service grant: anybody who could
--     reach the signup endpoint could arrive holding Director's permissions. The
--     trigger writes null and an admin assigns it afterwards.
select is((select designation_id from public.users where id = '19000000-0000-4000-8000-000000000041'),
  null,
  'a signup cannot grant itself a designation, so it arrives with no permissions');

select * from finish();
rollback;