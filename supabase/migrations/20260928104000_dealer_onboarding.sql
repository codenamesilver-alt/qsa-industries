-- Dealer onboarding, which PRD 4.3 implies and nothing implemented.
--
-- What exists: admin_upsert_dealer creates a dealer row, and
-- web/scripts/provision-user.mjs creates the login from a machine holding the
-- service role key. Those are two steps in two places, and the dealer row appears
-- the moment the first one runs. So there was no moment at which the record said
-- "this account exists but is not trading yet", and no record of who decided a new
-- dealer's credit, or when, or why.
--
-- Two design decisions, both taken to avoid a specific failure rather than for
-- tidiness. They are load bearing and a later migration that undoes either has to
-- deal with the reason written here.
--
-- 1. The onboarding dealer is public.dealers.status = 'inactive', and is flipped to
--    'active' by admin_activate_dealer. The obvious alternative is a fifth
--    dealer_status value called 'onboarding', and it is worse for two reasons.
--    It cannot be done in this file: db-migrate sends a migration as one
--    multi-statement query, and a value added by ALTER TYPE ... ADD VALUE cannot
--    be used until the transaction that added it commits, so the enum change and
--    the first write that needs the new value would have to be split across two
--    files for no benefit. And 'inactive' already means exactly the right thing to
--    every other part of the schema: stage5, stage6, stage7, the delivery board,
--    dealer_catalog and proxy orders all filter on status = 'active', so an
--    onboarding dealer is excluded from ordering, dispatch and the dealer catalogue
--    with no change to any of them. The onboarding record is what distinguishes
--    "not trading because onboarding" from "not trading because deactivated
--    later", which is the same shape as orders.status against
--    orders.delivery_status: two columns deliberately not merged.
--
-- 2. No stage column. The board view derives the stage from the facts, so there
--    is no second copy of the answer to fall out of step with the columns it was
--    computed from. Every fact here is written by exactly one function, and every
--    function refuses the transitions that would make the derived stage a lie.
--
-- Login creation needs the service role key, which must not reach a browser, so
-- it is not here either. supabase/functions/provision-dealer-login holds the key,
-- verifies the caller is an admin in the database rather than in the edge runtime,
-- creates the auth user, and then calls admin_link_dealer_login, which is granted
-- to service_role alone. That function is the only path from a created auth user to
-- a linked dealer login, and it re-checks the caller id it is handed, so an edge
-- function that skipped its own authorisation step would still be refused here.
--
-- The edge function is source in the repository, not something this migration
-- deploys. It needs SUPABASE_SERVICE_ROLE_KEY as an edge function secret, and
-- until it is deployed admin_activate_dealer cannot be satisfied from a browser,
-- because its login precondition is only reachable through it. See the README,
-- "The login edge function".
--
-- GSTIN and PAN are collected because an Indian feed dealer's invoice cannot be
-- issued without the GSTIN, and PRD 8.1 asks for a GST-compliant invoice. They are
-- not written onto the invoice: the invoice lines snapshot the dealer's state for
-- place of supply, and changing that is a finance change, not an onboarding one.
-- They are recorded here and validated here, so a bad one is caught at onboarding
-- rather than at the first invoice.

-- ---------------------------------------------------------------------------
-- The record
-- ---------------------------------------------------------------------------
create table public.dealer_onboardings (
  dealer_id uuid primary key references public.dealers (id) on delete cascade,
  gstin text,
  pan text,
  credit_limit_requested numeric(14, 2)
    check (credit_limit_requested is null or (credit_limit_requested >= 0 and credit_limit_requested <> 'NaN'::numeric)),
  credit_decided_at timestamptz,
  credit_decided_by uuid references public.users (id) on delete set null,
  credit_approved boolean,
  credit_decision_note text,
  login_user_id uuid references public.users (id) on delete set null,
  login_provisioned_at timestamptz,
  activated_at timestamptz,
  activated_by uuid references public.users (id) on delete set null,
  declined_at timestamptz,
  declined_by uuid references public.users (id) on delete set null,
  decline_reason text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A decision is a decision, not a decision plus its opposite. Without this, a
  -- row could carry credit_approved = true and credit_decided_at = null, which the
  -- board would have to guess about.
  constraint dealer_onboarding_credit_decision_whole
    check (num_nonnulls(credit_decided_at, credit_decided_by, credit_approved) in (0, 3)),
  -- Same reason for the close. A decline is a closure, and a half written one is
  -- indistinguishable from an open record to anything that reads the columns.
  constraint dealer_onboarding_decline_whole
    check (num_nonnulls(declined_at, declined_by, decline_reason) in (0, 3)),
  -- Declined and live are both closed states and cannot both be true. Without
  -- this the two functions could be called in either order and the board would
  -- have to pick one, which is exactly the ambiguity the decline columns exist
  -- to remove.
  constraint dealer_onboarding_not_declined_and_activated
    check (not (declined_at is not null and activated_at is not null))
);

create index dealer_onboardings_login_user_idx
  on public.dealer_onboardings (login_user_id)
  where login_user_id is not null;

create trigger dealer_onboardings_set_updated_at
before update on public.dealer_onboardings
for each row
execute function public.set_updated_at();

comment on table public.dealer_onboardings is
  'One row per dealer that is being brought on. Holds the facts the onboarding flow collects, not a derived stage: the stage is computed by dealer_onboarding_board, so it cannot disagree with these columns. A dealer is onboarded when this row exists, and trades when dealers.status = ''active''. Refusing credit and declining the onboarding are different facts in different columns: a refused credit is a decision about a number and leaves the record open for another decision, a decline is a closure and the record is finished.';

comment on column public.dealer_onboardings.gstin is
  'GST identification number, 15 characters, validated on write. Recorded here rather than on dealers because it is collected during onboarding and is not used to price, order or dispatch anything. It is not yet carried onto the invoice.';

comment on column public.dealer_onboardings.credit_limit_requested is
  'The limit the onboarding form asked for. Not the limit in force: that is dealers.credit_limit, which admin_upsert_dealer owns and which finance may change at any time. This is the request, kept so the decision is readable after the fact.';

alter table public.dealer_onboardings enable row level security;

-- Admin only, and only for reads. Every write in this file goes through a
-- function that checks the role itself, for the reason 20260926100600 gave: a
-- column grant cannot tell an admin from a dealer.
drop policy if exists dealer_onboardings_select_admin on public.dealer_onboardings;
create policy dealer_onboardings_select_admin
on public.dealer_onboardings
for select
to authenticated
using (private.current_user_role() = 'admin');

revoke all on table public.dealer_onboardings from anon, authenticated;
grant select on table public.dealer_onboardings to authenticated;

-- ---------------------------------------------------------------------------
-- private.is_gstin(p_gstin) and private.is_pan(p_pan)
--
-- Written as two functions rather than inline because both the start function and
-- the edit function need them, and a third copy of a GSTIN shape check would be a
-- third place to change it.
--
-- A GSTIN is 15 characters in this order: a 2 digit state code, then a 10
-- character PAN, then a 1 digit entity number, then the literal letter Z, then a
-- check character. The PAN is 5 letters, 4 digits, 1 letter.
--
-- The first draft of this pattern read
--   [0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9][A-Z][0-9][A-Z]
-- which is 16 characters and matches no GSTIN that exists. It was caught by
-- stage18, whose first assertion is a real GSTIN, and it is recorded here
-- because the failure mode is the dangerous direction for the other shape check
-- too: a pattern that is one character too long rejects every genuine value,
-- which would have made onboarding unusable rather than merely unsafe.
--
-- The check character is allowed to be a letter as well as a digit. It is
-- nominally a digit, but this pattern is positional and is not a checksum, so
-- refusing an odd last character here would block a dealer over a character
-- whose value this function never looks at.
--
-- Both patterns are upper case, and both take the value as given: the callers
-- trim and upper case before calling, so a pasted value with a trailing space is
-- handled by the trim rather than by loosening the pattern.
-- ---------------------------------------------------------------------------
create or replace function private.is_gstin(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
    and p_value ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9]Z[0-9A-Z]$'
$$;

comment on function private.is_gstin(text) is
  'True when the value is a well formed 15 character GSTIN. The pattern is positional, not a checksum: it rejects typos and malformed input but does not verify the check character, because no such verification is published that could be relied on. Null is false, so a caller cannot pass a null GSTIN and have it read as valid.';

create or replace function private.is_pan(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
    and p_value ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
$$;

comment on function private.is_pan(text) is
  'True when the value is a well formed 10 character PAN. Null is false.';

-- ---------------------------------------------------------------------------
-- public.admin_start_dealer_onboarding(...)
--
-- Creates the dealer and its onboarding record in one call. It could be two
-- calls to two existing functions, and that is deliberately not how it is done: a
-- dealer row with no onboarding row is a state the board cannot describe and the
-- activate function refuses, so a half-finished create would leave an account that
-- looks live on the admin screen and is not.
--
-- The dealer is created inactive, unpriced and uncredited. credit_limit is 0
-- rather than the requested figure on purpose: a requested limit is not a granted
-- one, and admin_upsert_dealer defaults to 0, so writing the request here would
-- let an unapproved figure be read as the dealer's limit by anything that looks at
-- credit_limit instead of the onboarding record. admin_activate_dealer copies the
-- request across, and that is the only path by which a new dealer gets a limit.
--
-- The sales rep is deliberately not required here. Territory is often settled after
-- the paperwork, and forcing it at this point buys nothing: activation refuses a
-- dealer with no active rep, because create_dealer_order reads the mapping and
-- orders.sales_rep_id is not null, so an account that went live unmapped could
-- never be ordered for.
-- ---------------------------------------------------------------------------
create or replace function public.admin_start_dealer_onboarding(
  p_name text,
  p_region text,
  p_gstin text default null,
  p_pan text default null,
  p_credit_limit_requested numeric default null,
  p_contact_person text default null,
  p_phone text default null,
  p_email text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null
)
returns public.dealers
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_dealer public.dealers%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_region text := nullif(trim(p_region), '');
  v_gstin text := upper(nullif(trim(p_gstin), ''));
  v_pan text := upper(nullif(trim(p_pan), ''));
  v_email text := nullif(trim(p_email), '');
  v_requested numeric;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can onboard a dealer';
  end if;

  if v_name is null then
    raise exception 'A dealer needs a name';
  end if;

  -- The same refusal admin_upsert_dealer makes, and for the same reason: the region
  -- report asserts that no dealer falls through to Unassigned, and that assertion
  -- is only true if a dealer cannot exist without a region.
  if v_region is null then
    raise exception 'A dealer needs a sales region';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Dealer email does not look like an email address';
  end if;

  -- Normalised to upper case rather than refused for being lower case, because a
  -- GSTIN is defined in upper case and every tool that reads one expects that. A
  -- lower case GSTIN is a paste, not a different tax payer.
  if v_gstin is not null and not private.is_gstin(v_gstin) then
    raise exception 'GSTIN must be 15 characters in the format 22AAAAA0000A1Z5';
  end if;

  if v_pan is not null and not private.is_pan(v_pan) then
    raise exception 'PAN must be 10 characters in the format AAAAA0000A';
  end if;

  if p_credit_limit_requested is not null
    and (
      p_credit_limit_requested < 0
      or p_credit_limit_requested = 'NaN'::numeric
    ) then
    raise exception 'Requested credit limit must be zero or more';
  end if;

  v_requested := p_credit_limit_requested;

  insert into public.dealers (
    name,
    contact_person,
    phone,
    email,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    credit_limit,
    status,
    region
  )
  values (
    v_name,
    nullif(trim(p_contact_person), ''),
    nullif(trim(p_phone), ''),
    v_email,
    nullif(trim(p_address_line1), ''),
    nullif(trim(p_address_line2), ''),
    nullif(trim(p_city), ''),
    nullif(trim(p_state), ''),
    nullif(trim(p_postal_code), ''),
    0,
    'inactive'::public.dealer_status,
    v_region
  )
  returning * into new_dealer;

  insert into public.dealer_onboardings (
    dealer_id,
    gstin,
    pan,
    credit_limit_requested,
    created_by
  )
  values (
    new_dealer.id,
    v_gstin,
    v_pan,
    v_requested,
    (select auth.uid())
  );

  return new_dealer;
end;
$$;

comment on function public.admin_start_dealer_onboarding(text, text, text, text, numeric, text, text, text, text, text, text, text, text) is
  'Create a dealer and open its onboarding record in one call, so no dealer can exist without the record that says it is still being onboarded. Admin only. The dealer is created inactive with a credit limit of 0 and no sales rep: a requested limit is not a granted one, and admin_activate_dealer is the only thing that grants either.';

-- ---------------------------------------------------------------------------
-- public.admin_edit_dealer_onboarding(...)
--
-- The onboarding half of the edit, deliberately separate from
-- admin_upsert_dealer rather than folded into it. That function owns the dealer
-- master, including the commercial columns that finance may also change; this one
-- owns the GSTIN, the PAN and the requested limit. Merging them would mean every
-- keystroke in the onboarding form passed through the finance-facing column guard,
-- and would give admin_upsert_dealer a second reason to exist.
--
-- Editing is refused once a credit decision is recorded. The decision is a fact
-- about a stated request, and letting the request move afterwards would leave a
-- signed-off decision attached to a number nobody approved. Reopening is possible
-- by recording a new decision, which is the audit trail working rather than
-- working around it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_edit_dealer_onboarding(
  p_dealer_id uuid,
  p_gstin text,
  p_pan text,
  p_credit_limit_requested numeric
)
returns public.dealer_onboardings
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealer_onboardings%rowtype;
  v_gstin text := upper(nullif(trim(p_gstin), ''));
  v_pan text := upper(nullif(trim(p_pan), ''));
  v_requested numeric;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can edit a dealer onboarding record';
  end if;

  select * into saved_row
  from public.dealer_onboardings
  where dealer_id = p_dealer_id;

  if saved_row.dealer_id is null then
    raise exception 'No onboarding record for that dealer. Start onboarding first.';
  end if;

  if saved_row.credit_decided_at is not null then
    raise exception
      'This onboarding already has a credit decision. Record a new decision rather than changing the request underneath it.';
  end if;

  if saved_row.declined_at is not null then
    raise exception
      'This onboarding has been declined, so the request is closed. Onboard the dealer again if they come back.';
  end if;

  if v_gstin is not null and not private.is_gstin(v_gstin) then
    raise exception 'GSTIN must be 15 characters in the format 22AAAAA0000A1Z5';
  end if;

  if v_pan is not null and not private.is_pan(v_pan) then
    raise exception 'PAN must be 10 characters in the format AAAAA0000A';
  end if;

  if p_credit_limit_requested is not null
    and (
      p_credit_limit_requested < 0
      or p_credit_limit_requested = 'NaN'::numeric
    ) then
    raise exception 'Requested credit limit must be zero or more';
  end if;

  v_requested := case
    when p_credit_limit_requested is null then null
    else p_credit_limit_requested
  end;

  update public.dealer_onboardings
     set gstin = v_gstin,
         pan = v_pan,
         credit_limit_requested = v_requested
   where dealer_id = p_dealer_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_edit_dealer_onboarding(uuid, text, text, numeric) is
  'Set the GSTIN, PAN and requested credit limit on an open onboarding record. Admin only. Refused once a credit decision exists, so an approved figure can never be attached to a request nobody saw.';

-- ---------------------------------------------------------------------------
-- public.admin_record_dealer_credit_decision(...)
--
-- Approve or refuse, with who and when. A refusal is a real outcome that has to be
-- recorded, not the absence of a row, so credit_refused is a first class result
-- here and the reason is kept in credit_decision_note.
--
-- A refusal does not close the record. It is a decision about a number, and
-- admin_decline_dealer_onboarding is the thing that closes one. Keeping the two in
-- one column is what the first draft of this file did, and it made a refused
-- credit indistinguishable from a declined onboarding.
--
-- p_note is mandatory on a refusal and optional on an approval. That asymmetry is
-- the point: refusing a dealer's credit is the outcome a person will later be asked
-- to justify, and a refusal with no reason recorded is not a decision.
--
-- A re-decision is allowed and overwrites, deliberately. Approving then refusing
-- after a credit check comes back is a normal sequence, and the answer to "why does
-- this dealer have no credit" has to be the current reason. The previous decision is
-- not kept in a history table; if that is wanted it belongs in the audit log this
-- project does not yet have, and inventing a half version of one here would be
-- worse than the gap.
-- ---------------------------------------------------------------------------
create or replace function public.admin_record_dealer_credit_decision(
  p_dealer_id uuid,
  p_approved boolean,
  p_note text default null
)
returns public.dealer_onboardings
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealer_onboardings%rowtype;
  v_note text := nullif(trim(p_note), '');
  v_actor uuid := (select auth.uid());
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can decide a new dealer''s credit';
  end if;

  select * into saved_row
  from public.dealer_onboardings
  where dealer_id = p_dealer_id;

  if saved_row.dealer_id is null then
    raise exception 'No onboarding record for that dealer';
  end if;

  if saved_row.activated_at is not null then
    raise exception
      'This dealer is already live. Change the credit limit through the dealer master instead.';
  end if;

  if saved_row.declined_at is not null then
    raise exception
      'This onboarding has been declined, so the record is closed and cannot carry a new decision.';
  end if;

  if coalesce(p_approved, false) and v_note is null and saved_row.credit_limit_requested is null then
    raise exception
      'Approving credit with no requested limit would activate a dealer at zero. Record the limit first.';
  end if;

  if not coalesce(p_approved, false) and v_note is null then
    raise exception 'Refusing credit needs a reason';
  end if;

  -- Deliberately not writing a rejection reason here. A refusal is a decision about
  -- a number, it lives in credit_decision_note where it is already mandatory, and
  -- the record stays open. The old code also copied the note into rejection_reason,
  -- which made a refused credit look identical to a closed onboarding: declining
  -- then refused the decline, a later approval left the reason behind, and the
  -- board reported an active dealer as declined.
  update public.dealer_onboardings
     set credit_approved = coalesce(p_approved, false),
         credit_decided_at = now(),
         credit_decided_by = v_actor,
         credit_decision_note = v_note
   where dealer_id = p_dealer_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_record_dealer_credit_decision(uuid, boolean, text) is
  'Approve or refuse a new dealer''s credit, recording who decided and when. Admin only. A refusal requires a reason and is kept in credit_decision_note; it does not close the record, because a dealer refused on one figure may be onboarded again on another. A later decision replaces an earlier one rather than being refused, because a credit check that comes back late is a normal sequence, not an attempt to rewrite a record. A live dealer and a declined onboarding are both refused here.';

-- ---------------------------------------------------------------------------
-- public.admin_link_dealer_login(p_caller_id, p_dealer_id, p_user_id)
--
-- The only path from a created auth user to a linked dealer login, and the reason
-- login creation can live in an edge function at all.
--
-- Granted to service_role and NOT to authenticated, which is what makes the
-- p_caller_id parameter safe to accept. A browser cannot call this. The edge
-- function holding the service role key is the only caller, and it already has
-- every privilege this function has, so accepting a claimed admin id from it grants
-- nothing new. What it buys is that the function does not trust the edge runtime's
-- own authorisation step: it re-reads p_caller_id out of public.users and refuses
-- anything that is not an active admin. An edge function that were misconfigured,
-- or later edited to skip its check, still cannot link a login as a non-admin.
--
-- The order of the checks is the order of the failure modes. Identity first, then
-- the login, then the dealer, then the link itself.
--
-- on delete set null on login_user_id: deleting the auth user must not delete the
-- onboarding record, which is the record that the dealer was onboarded at all.
-- ---------------------------------------------------------------------------
create or replace function public.admin_link_dealer_login(
  p_caller_id uuid,
  p_dealer_id uuid,
  p_user_id uuid
)
returns public.dealer_onboardings
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealer_onboardings%rowtype;
begin
  if p_caller_id is null or not exists (
    select 1
    from public.users as u
    where u.id = p_caller_id
      and u.role = 'admin'
      and u.is_active
  ) then
    raise exception 'Only an active admin can link a dealer login';
  end if;

  select * into saved_row
  from public.dealer_onboardings
  where dealer_id = p_dealer_id;

  if saved_row.dealer_id is null then
    raise exception 'No onboarding record for that dealer';
  end if;

  if p_user_id is null or not exists (
    select 1 from public.users as u where u.id = p_user_id
  ) then
    raise exception 'No user with that id. The auth user must exist and have a profile first.';
  end if;

  -- A login already holding a dealer is not relinkable. admin_upsert_user_profile
  -- allows an admin to point a dealer login at a different dealer, which is the
  -- right tool for a correction; this is the onboarding path and a second way to do
  -- the same move would be a second set of rules to keep in step.
  if exists (
    select 1
    from public.users as u
    where u.id = p_user_id
      and u.dealer_id is not null
      and u.dealer_id is distinct from p_dealer_id
  ) then
    raise exception
      'That login is already linked to another dealer. Change it on the user itself.';
  end if;

  if not exists (
    select 1
    from public.users as u
    where u.id = p_user_id and u.role = 'dealer'
  ) then
    raise exception 'A dealer login must carry the dealer role';
  end if;

  if saved_row.login_user_id is not null
    and saved_row.login_user_id is distinct from p_user_id then
    raise exception
      'This dealer already has a login. Delete it from the user directory first.';
  end if;

  if saved_row.declined_at is not null then
    raise exception
      'This onboarding has been declined, so there is nothing to attach a login to';
  end if;

  -- Idempotent for the same user, because the edge function may retry after a
  -- network failure and a retry that fails on a half-finished write would leave the
  -- admin with an auth user and no way to attach it from the browser.
  if saved_row.login_user_id = p_user_id then
    return saved_row;
  end if;

  update public.users
     set dealer_id = p_dealer_id
   where id = p_user_id;

  update public.dealer_onboardings
     set login_user_id = p_user_id,
         login_provisioned_at = now()
   where dealer_id = p_dealer_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_link_dealer_login(uuid, uuid, uuid) is
  'Attach a freshly created auth user to an onboarding dealer as their login. Granted to service_role alone, never to authenticated, so p_caller_id is a claim by the edge function rather than by a browser. The caller id is re-read from public.users and must be an active admin, so the authorisation decision is made here and not in the edge runtime. Idempotent for the same user so a retry after a network failure succeeds.';

-- ---------------------------------------------------------------------------
-- public.admin_activate_dealer(p_dealer_id)
--
-- The one thing that makes a new dealer trade. Four preconditions, each for a
-- reason that is not "tidiness":
--
--   credit approved     otherwise there is no decision to activate against.
--   login provisioned   an active dealer nobody can log in as is a hole in the
--                       book, and the account would look live on every screen.
--   active sales rep    create_dealer_order reads dealers.sales_rep_id and
--                       orders.sales_rep_id is not null, so an unmapped live dealer
--                       cannot be ordered for by anyone, including its own portal.
--   still inactive      activating an active dealer would rewrite activated_at and
--                       silently claim it was onboarded twice.
--
-- The credit limit is copied from the request here, and this is the only path by
-- which a newly onboarded dealer gets one. It is a copy rather than a reference
-- because credit_limit is the master value and the request is a historical fact:
-- once live, finance can change the limit through the dealer master and the
-- request must not follow it.
--
-- An approval override is left alone. If finance has set one, that is a deliberate
-- later decision, and overwriting it with the onboarding request would undo it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activate_dealer(p_dealer_id uuid)
returns public.dealers
language plpgsql
security definer
set search_path = ''
as $$
declare
  onboard_row public.dealer_onboardings%rowtype;
  dealer_row public.dealers%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can activate a new dealer';
  end if;

  select * into onboard_row
  from public.dealer_onboardings
  where dealer_id = p_dealer_id;

  if onboard_row.dealer_id is null then
    raise exception 'No onboarding record for that dealer';
  end if;

  select * into dealer_row
  from public.dealers
  where id = p_dealer_id;

  if dealer_row.id is null then
    raise exception 'No dealer with that id';
  end if;

  if dealer_row.status = 'active' then
    raise exception 'This dealer is already active';
  end if;

  if onboard_row.activated_at is not null then
    raise exception 'This dealer was already activated';
  end if;

  if onboard_row.declined_at is not null then
    raise exception
      'This onboarding has been declined, so the dealer cannot be activated';
  end if;

  if onboard_row.credit_decided_at is null then
    raise exception 'Record a credit decision before activating';
  end if;

  if onboard_row.credit_approved is not true then
    raise exception 'Credit was refused for this dealer, so it cannot be activated';
  end if;

  if onboard_row.login_user_id is null or onboard_row.login_provisioned_at is null then
    raise exception 'Provision the dealer login before activating';
  end if;

  if dealer_row.sales_rep_id is null then
    raise exception
      'Map the dealer to an active sales rep before activating, or no one can order for it';
  end if;

  if not exists (
    select 1
    from public.users as u
    where u.id = dealer_row.sales_rep_id
      and u.role = 'sales_rep'
      and u.is_active
  ) then
    raise exception 'The mapped sales rep is not an active sales rep';
  end if;

  update public.dealers
     set status = 'active'::public.dealer_status,
         credit_limit = coalesce(onboard_row.credit_limit_requested, 0)
   where id = p_dealer_id
  returning * into dealer_row;

  update public.dealer_onboardings
     set activated_at = now(),
         activated_by = (select auth.uid())
   where dealer_id = p_dealer_id;

  return dealer_row;
end;
$$;

comment on function public.admin_activate_dealer(uuid) is
  'Make an onboarded dealer trade, once credit is approved, a login exists, an active sales rep is mapped and the dealer is still inactive. Admin only. Copies the requested credit limit onto dealers.credit_limit, which is the only path by which a newly onboarded dealer gets a limit; an existing approval override is left alone because that is a later finance decision.';

-- ---------------------------------------------------------------------------
-- public.admin_decline_dealer_onboarding(p_dealer_id, p_reason)
--
-- Refusal that is not a credit decision. The two are different acts with different
-- consequences: a credit refusal leaves a dealer who may be onboarded again later
-- with a different figure, and a decline closes the record because the dealer is
-- not proceeding at all.
--
-- It does not touch the dealer row. The dealer stays inactive and keeps its row,
-- because orders and invoices reference dealers and the audit trail is worth more
-- than the tidiness of not having created it. Reopening is not offered: a declined
-- dealer that comes back is a new onboarding, and admin_start_dealer_onboarding
-- refuses to open a second record for a dealer that already has one.
-- ---------------------------------------------------------------------------
create or replace function public.admin_decline_dealer_onboarding(
  p_dealer_id uuid,
  p_reason text
)
returns public.dealer_onboardings
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealer_onboardings%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can decline a dealer onboarding';
  end if;

  if v_reason is null then
    raise exception 'Declining an onboarding needs a reason';
  end if;

  select * into saved_row
  from public.dealer_onboardings
  where dealer_id = p_dealer_id;

  if saved_row.dealer_id is null then
    raise exception 'No onboarding record for that dealer';
  end if;

  if saved_row.activated_at is not null then
    raise exception
      'This dealer is already live. Set the account status on the dealer master instead.';
  end if;

  if saved_row.declined_at is not null then
    raise exception 'This onboarding has already been declined';
  end if;

  update public.dealer_onboardings
     set declined_at = now(),
         declined_by = (select auth.uid()),
         decline_reason = v_reason
   where dealer_id = p_dealer_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_decline_dealer_onboarding(uuid, text) is
  'Close an onboarding that is not proceeding, with a reason. Admin only. Distinct from refusing credit: a refused credit is kept in credit_decision_note and leaves the record open for another decision, this writes declined_at, declined_by and decline_reason and finishes it. The dealer row is left in place and inactive, because orders and invoices reference it and the trail is worth more than the absence of the row. There is no reopen, so a dealer who comes back is a new onboarding.';

-- ---------------------------------------------------------------------------
-- public.dealer_onboarding_board
--
-- The screen's read model, and the reason there is no stage column. Every derived
-- value is computed here from the facts, so it cannot be stale.
--
-- The stage order is deliberate and is the order the flow runs in. Six stages, and
-- the first two are closed states checked before any open one, because a closed
-- record can also satisfy the conditions of an open stage:
--   declined              the record is closed. Checked before everything else.
--   live                  approved, activated, and the dealer is trading. The
--                         check is dealers.status = 'active' rather than
--                         activated_at alone, because an admin can deactivate a
--                         live dealer from the dealer master and that dealer is
--                         not then "onboarding".
--   deactivated           onboarded, and deactivated since. Reported as its own
--                         stage rather than as a fallthrough, so a suspended
--                         dealer is never read as an onboarding in progress.
--   awaiting_activation   approved, logged in, still inactive. The rep mapping is
--                         deliberately not part of this stage, and that is the
--                         correction this file records. Requiring d.sales_rep_id
--                         here looked harmless and was not: an approved, logged in
--                         dealer with nobody mapped to it fell through every open
--                         branch to credit_refused, because that branch only tests
--                         credit_decided_at and an approval sets it. The dealer had
--                         been refused nothing. The rep mapping is a precondition,
--                         and preconditions are reported by outstanding, which
--                         already names it; the stage says which state the record
--                         is in, and this one is approved and waiting to go live.
--   awaiting_login        approved, and no login yet.
--   credit_refused        a decision was recorded and it was not an approval. The
--                         record is still open, so this is a state to come back
--                         to rather than a dead end.
--   awaiting_credit       no decision yet and a request is on the table.
--   paper                 the record is barely filled in.
--
-- A dealer with no onboarding record is not in this view at all, and that is the
-- point: it means "this account has been trading since before onboarding existed",
-- which is a different thing and is read from the dealer master instead.
--
-- security_invoker so RLS still decides who sees a row. On this table the only
-- policy is admin, so in practice admin alone reads it, and the view stays honest
-- if that policy is ever widened.
-- ---------------------------------------------------------------------------
drop view if exists public.dealer_onboarding_board;

create view public.dealer_onboarding_board
with (security_invoker = true)
as
select
  o.dealer_id,
  d.name as dealer_name,
  d.region,
  d.state,
  d.status as dealer_status,
  d.sales_rep_id,
  coalesce(nullif(rep.full_name, ''), 'Unassigned') as rep_name,
  d.credit_limit,
  d.credit_limit_override,
  o.gstin,
  o.pan,
  o.credit_limit_requested,
  o.credit_decided_at,
  o.credit_decided_by,
  coalesce(nullif(decider.full_name, ''), 'Unknown') as credit_decided_by_name,
  o.credit_approved,
  o.credit_decision_note,
  o.login_user_id,
  o.login_provisioned_at,
  login_user.email as login_email,
  o.activated_at,
  o.activated_by,
  o.declined_at,
  o.declined_by,
  o.decline_reason,
  o.created_at,
  o.updated_at,
  case
    -- Closed, checked first: a declined onboarding can also carry a credit
    -- decision, and every later branch would report it as still moving.
    when o.declined_at is not null then 'declined'
    when o.activated_at is not null and d.status = 'active' then 'live'
    -- Onboarded, and deactivated since. Its own stage rather than a fallthrough,
    -- because the two open branches below would otherwise match it: this record
    -- has an approval, a login and a rep, so it reads as awaiting_activation, and
    -- an admin looking at a dealer they suspended in error would be told the
    -- onboarding is still in progress. It is not waiting on anything.
    when o.activated_at is not null then 'deactivated'
    when o.credit_approved is true
      and o.login_user_id is not null
      and o.login_provisioned_at is not null
      then 'awaiting_activation'
    -- The login test is restated rather than left as the bare "credit approved"
    -- fallback. The fallback also matched a dealer whose login exists but whose
    -- rep is unmapped, because the branch above requires a rep, so the board
    -- reported "awaiting_login" for a dealer who already had a login and was
    -- waiting for a rep. The outstanding list was right and the stage was not,
    -- which is the worst combination: an admin reads the stage first.
    --
    -- The same shape of fallthrough happened one branch lower, and dropping the
    -- rep test above fixes both: the two branches are now disjoint on the login
    -- alone, so an approved dealer reads as waiting for the login only when the
    -- login is genuinely missing, and a dealer who was refused nothing is never
    -- reported as refused.
    when o.credit_approved is true then 'awaiting_login'
    when o.credit_decided_at is not null then 'credit_refused'
    when o.gstin is not null and o.credit_limit_requested is not null then 'awaiting_credit'
    else 'paper'
  end as stage,
  -- What is still missing before this dealer can trade, in the order the flow needs
  -- it. A single sentence the screen can show, rather than making an admin work
  -- out from four columns which precondition failed. Null on a closed record: a
  -- declined or live dealer is not waiting on anything.
  case
    when o.declined_at is not null or o.activated_at is not null then null
    else array_remove(
      array[
        case
          when o.credit_decided_at is null
            then 'record a credit decision'
          else null
        end,
        case
          when o.credit_approved is true
            and (o.login_user_id is null or o.login_provisioned_at is null)
            then 'provision the dealer login'
          else null
        end,
        case
          when o.credit_approved is true
            and d.sales_rep_id is null
            then 'map an active sales rep'
          else null
        end
      ],
      null
    )
  end as outstanding
from public.dealer_onboardings as o
join public.dealers as d on d.id = o.dealer_id
left join public.users as rep on rep.id = d.sales_rep_id
left join public.users as decider on decider.id = o.credit_decided_by
left join public.users as login_user on login_user.id = o.login_user_id;

comment on view public.dealer_onboarding_board is
  'The onboarding screen read model, with the stage derived from the recorded facts rather than stored beside them, so it cannot drift. One row per dealer that has an onboarding record; a dealer that has been trading since before onboarding existed has no record and is not here. Outstanding is the ordered list of what still stands between this dealer and trading.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- On table, not on view: PostgreSQL has no "view" object type in REVOKE, and a
-- view is covered by TABLE. The twelve earlier files in this directory already
-- write it this way, and writing "on view" fails with a syntax error at the word
-- public.
revoke all on table public.dealer_onboarding_board from public, anon, authenticated;
grant select on public.dealer_onboarding_board to authenticated;

revoke all on function private.is_gstin(text) from public, anon;
revoke all on function private.is_pan(text) from public, anon;

-- The five admin-callable functions. Revoked from public and by name from anon, for
-- the reason 20260927093000 gave: on a hosted Supabase project the default
-- privileges grant EXECUTE on every new public function to anon, so revoking from
-- public alone leaves anon holding it by direct grant.
revoke all on function public.admin_start_dealer_onboarding(text, text, text, text, numeric, text, text, text, text, text, text, text, text) from public;
revoke all on function public.admin_edit_dealer_onboarding(uuid, text, text, numeric) from public;
revoke all on function public.admin_record_dealer_credit_decision(uuid, boolean, text) from public;
revoke all on function public.admin_activate_dealer(uuid) from public;
revoke all on function public.admin_decline_dealer_onboarding(uuid, text) from public;

revoke all on function public.admin_start_dealer_onboarding(text, text, text, text, numeric, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.admin_edit_dealer_onboarding(uuid, text, text, numeric) from anon;
revoke all on function public.admin_record_dealer_credit_decision(uuid, boolean, text) from anon;
revoke all on function public.admin_activate_dealer(uuid) from anon;
revoke all on function public.admin_decline_dealer_onboarding(uuid, text) from anon;

grant execute on function public.admin_start_dealer_onboarding(text, text, text, text, numeric, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.admin_edit_dealer_onboarding(uuid, text, text, numeric) to authenticated;
grant execute on function public.admin_record_dealer_credit_decision(uuid, boolean, text) to authenticated;
grant execute on function public.admin_activate_dealer(uuid) to authenticated;
grant execute on function public.admin_decline_dealer_onboarding(uuid, text) to authenticated;

-- admin_link_dealer_login is granted to service_role and to nobody else. There is
-- deliberately no grant to authenticated, and no grant to postgres beyond what
-- service_role inherits: a browser must not be able to name a caller id and have it
-- believed.
revoke all on function public.admin_link_dealer_login(uuid, uuid, uuid) from public;
revoke all on function public.admin_link_dealer_login(uuid, uuid, uuid) from anon;
revoke all on function public.admin_link_dealer_login(uuid, uuid, uuid) from authenticated;
grant execute on function public.admin_link_dealer_login(uuid, uuid, uuid) to service_role;
