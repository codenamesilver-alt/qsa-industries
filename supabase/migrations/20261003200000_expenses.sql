-- General expenses: an expense-head catalogue and an append-only register of money
-- leaving the company for something that is not a purchase order and not an invoice
-- payment.
--
-- What this is for, stated up front because the distinction is the whole design:
--
--   public.payments        money coming IN from a dealer. Receivable side.
--   public.expenses        money going OUT to a vendor, a landlord, a visitor, a
--                          bank charge, a courier. Neither side of the receivable.
--
-- They share no table, no function and no view. An expense is never netted against an
-- invoice, because an expense does not reduce what a dealer owes -- it reduces what the
-- company earned. Netting them into one "cash movement" table would make that difference
-- invisible in the schema, and it is exactly the difference a P&L is made of.
--
-- Append-only, with a void flag. public.stock_movements already sets the precedent in
-- this project (20260925092500): a movement is never edited, it is reversed. An expense
-- is the same kind of fact -- money left the bank on a day -- and correcting the amount
-- of a day on which money left the bank is not an edit, it is a different fact. So:
--
--   * no UPDATE grant on public.expenses at all. Not even for an admin. There is no
--     code path that can rewrite amount, head or date.
--   * public.void_expense() is the only way a recorded row stops counting. It writes
--     is_void, a mandatory reason, who did it and when, and it refuses a second void.
--   * The reason is required because "this entry was wrong" and "this was a duplicate"
--     are different problems and the register has to say which.
--
-- A voided row keeps its amount in the table and is netted to zero by the views, rather
-- than being deleted. Deleting it would leave the register unable to answer "did we pay
-- this twice", which is the first question anybody asks after discovering a duplicate.
--
-- Tax split is optional and, when present, must reconcile exactly. An expense is often
-- simply "rent, 40,000" with nothing to break down; it is sometimes an input claim where
-- the taxable part and the tax part matter. Both are real, so taxable_amount and
-- tax_amount are a nullable pair with a check that they add up to amount, and `amount`
-- stays the single authoritative figure of money that left the bank. Adding them as a
-- third stored total would mean three numbers that can disagree.
--
-- Attachment is a storage path in a private bucket, not a public URL. public.products
-- and the rest of this schema store no files at all, so this is the first bucket in the
-- project; it is private, and both read and write are admin/finance only, because a
-- bill receipt is as sensitive as the invoice it sits next to. The client mints a signed
-- URL per view rather than storing a URL that expires in the row.
--
-- Roles. admin and finance, the same pair every other finance surface uses
-- (20260925091500). Deliberately read with private.current_user_role() rather than
-- private.can_access(), because no policy in this project calls can_access() yet
-- (20261003150000 records that as still-unwired); switching one policy over before the
-- rest would make this the one screen whose access differs from every screen beside it.
--
-- Permission catalogue. Two codes are added and seeded onto the finance role so the
-- matrix on the admin screen is not missing rows, but nothing reads them. That is the
-- same status 20261003150000 leaves the whole table in: the source of truth is being
-- built, not yet in force.

-- ---------------------------------------------------------------------------
-- 1. The head catalogue
--
-- Shaped like public.designations because it is the same kind of thing: a list of
-- options somebody must pick from, which people are careless with when they type it
-- free, and which needs a retire rather than a delete once money has been filed under
-- it. "Travel" and "travel" and "Travelling" are three heads and three totals.
-- ---------------------------------------------------------------------------

create table public.expense_heads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_heads_name_unique unique (name),
  constraint expense_heads_name_not_blank check (char_length(trim(name)) > 0),
  constraint expense_heads_name_length check (char_length(name) <= 120),
  constraint expense_heads_description_length check (description is null or char_length(description) <= 240)
);

comment on table public.expense_heads is
  'The catalogue of what money is spent on: Rent, Travel, Utilities, Bank Charges. One row per head, so the expense register can be grouped without every row repeating a spelling of its own category. Renamed rather than deleted when the wording changes, because expenses point at the row.';

comment on column public.expense_heads.is_active is
  'A retired head leaves the picker so nobody files new expenses against it, while past expenses keep pointing at it and keep their grouping. Not the same as deleting, which would reparent the history.';

create index expense_heads_active_order_idx on public.expense_heads (is_active, sort_order, name);

create trigger expense_heads_set_updated_at
  before update on public.expense_heads
  for each row
  execute function public.set_updated_at();

alter table public.expense_heads enable row level security;

-- Readable by any signed-in account, for the same reason designations are: this is a
-- list of words, and the expense screen is the only consumer. Gating it on the finance
-- roles would be defensive about nothing while making the table harder to reason about
-- in the one place that needs it.
drop policy if exists expense_heads_read_authenticated on public.expense_heads;
create policy expense_heads_read_authenticated
  on public.expense_heads
  for select
  to authenticated
  using (true);

revoke all on table public.expense_heads from anon;
revoke all on table public.expense_heads from authenticated;
grant select on public.expense_heads to authenticated;

-- A card receipt is money that left too, and the enum could not say so. Adding the
-- value here rather than defining a second mode enum for expenses is the point of
-- sharing one: record_invoice_payment and record_dealer_payment take this same type, so
-- a card receipt against an invoice was equally unrepresentable before this line.
-- The value is appended, so the existing five -- cash, bank_transfer, upi, cheque,
-- other -- keep their relative order and nothing that reads them positionally shifts.
alter type public.payment_mode add value if not exists 'card';

-- ---------------------------------------------------------------------------
-- 2. The register
--
-- amount is the money that left the bank. vendor is free text on purpose: this project
-- has a dealer master and no vendor master, and adding one is a different migration
-- with its own onboarding rules. A text column is honest about that -- it records who
-- was paid without pretending they are managed.
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  head_id uuid not null references public.expense_heads (id) on delete restrict,
  expense_date date not null default private.business_date(),
  amount numeric(14, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  vendor text,
  mode public.payment_mode not null default 'bank_transfer',
  reference text,
  taxable_amount numeric(14, 2) check (taxable_amount >= 0 and taxable_amount <> 'NaN'::numeric),
  tax_amount numeric(14, 2) check (tax_amount >= 0 and tax_amount <> 'NaN'::numeric),
  attachment_path text,
  notes text,
  is_void boolean not null default false,
  void_reason text,
  voided_by uuid references public.users (id) on delete restrict,
  voided_at timestamptz,
  recorded_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  -- The optional tax split, as one rule. Both null, or both present and summing to
  -- exactly amount. Written as a single check so there is no window in which half a
  -- split exists.
  constraint expenses_tax_split_consistent check (
    (taxable_amount is null and tax_amount is null)
    or (taxable_amount is not null and tax_amount is not null
        and taxable_amount + tax_amount = amount)
  ),
  -- A void is a fact about a row, so it has to carry its own evidence. is_void true
  -- with no reason, or with no actor, or with no timestamp, would each be a claim
  -- somebody could not check.
  constraint expenses_void_is_complete check (
    not is_void
    or (void_reason is not null and char_length(trim(void_reason)) > 0
        and voided_by is not null and voided_at is not null)
  ),
  constraint expenses_void_reason_length check (void_reason is null or char_length(void_reason) <= 240),
  constraint expenses_vendor_length check (vendor is null or char_length(vendor) <= 160),
  constraint expenses_reference_length check (reference is null or char_length(reference) <= 120),
  constraint expenses_notes_length check (notes is null or char_length(notes) <= 500),
  constraint expenses_attachment_path_length check (attachment_path is null or char_length(attachment_path) <= 400)
);

comment on table public.expenses is
  'General expenses: money leaving the company for something that is not a purchase order and not a dealer payment. Append-only. A recorded row is never edited or deleted -- public.void_expense() is the only exit, and it leaves the row in place with is_void set so the register can still answer whether a payment was made twice.';

comment on column public.expenses.amount is
  'Money that left the bank, in rupees, exclusive of nothing and inclusive of everything. The single authoritative figure. When taxable_amount and tax_amount are present they must sum to this, so there is never a second total to disagree with it.';

comment on column public.expenses.taxable_amount is
  'Optional. The pre-tax part, for an expense where the input credit matters. Null on the majority of rows, which is the common case and not a data gap.';

comment on column public.expenses.vendor is
  'Who was paid, as typed. Free text because this project has no vendor master: pretending otherwise with a nullable FK to nothing would be worse than admitting it. Duplicates are expected and are not a constraint violation.';

comment on column public.expenses.attachment_path is
  'Path inside the private expense-documents bucket, not a URL. Read through a short-lived signed URL so the stored value cannot expire and cannot be shared onward by copying it out of the database.';

comment on column public.expenses.is_void is
  'True once void_expense() has been called. The row keeps its amount for the duplicate check and is excluded from net totals by the views below.';

create index expenses_date_idx on public.expenses (expense_date desc, created_at desc);
create index expenses_head_idx on public.expenses (head_id, expense_date desc);
-- The totals view groups by head over live rows only. A partial index keeps the
-- voided majority out of that scan once the register is large.
create index expenses_live_head_idx on public.expenses (head_id) where not is_void;

alter table public.expenses enable row level security;

drop policy if exists expenses_select_internal on public.expenses;
create policy expenses_select_internal
  on public.expenses
  for select
  to authenticated
  using (private.current_user_role() in ('admin', 'finance'));

-- No insert policy and no update policy. The writes are void_expense() and
-- record_expense(), both security definer, so a policy here would only ever be a
-- second, weaker way in.
revoke all on table public.expenses from anon;
revoke all on table public.expenses from authenticated;
grant select on public.expenses to authenticated;

-- NOTE: service_role's insert/update/delete are revoked by the follow-up migration
-- 20261003210000, because the revoke cannot live in this file. This migration is
-- already recorded as applied, and per README "Migration history" a recorded migration
-- is not rewritten -- a correction ships as a new forward migration.

-- ---------------------------------------------------------------------------
-- 3. Reads
--
-- Two views, both security_invoker, so they inherit the table policies above rather
-- than inventing their own view of who may read.
--
-- expense_ledger is the register as the screen draws it: head name resolved, and a
-- net_amount that is zero for a voided row. Doing the netting in the view is what lets
-- one list show both "what we spent" and "what was written off" without the client
-- having to remember to subtract.
--
-- expense_totals_by_head is the grouped answer, and it also nets. Counting voided rows
-- separately rather than dropping them is deliberate: a head whose every expense was
-- voided should read as zero spent and 2 written off, not as a head that never existed.
-- ---------------------------------------------------------------------------

create or replace view public.expense_ledger
with (security_invoker = true)
as
select
  e.id,
  e.head_id,
  h.name as head_name,
  h.is_active as head_is_active,
  e.expense_date,
  e.amount,
  case when e.is_void then 0::numeric else e.amount end as net_amount,
  e.vendor,
  e.mode,
  e.reference,
  e.taxable_amount,
  e.tax_amount,
  e.attachment_path,
  e.notes,
  e.is_void,
  e.void_reason,
  e.voided_at,
  e.recorded_by,
  e.created_at
from public.expenses as e
join public.expense_heads as h on h.id = e.head_id;

comment on view public.expense_ledger is
  'The expense register with the head name resolved and voided rows netted to zero. One row per recorded expense, including voided ones, because the register has to be able to show that something was paid and later written off.';

create or replace view public.expense_totals_by_head
with (security_invoker = true)
as
select
  h.id as head_id,
  h.name as head_name,
  h.is_active as head_is_active,
  count(e.id) as expense_count,
  count(e.id) filter (where e.is_void) as voided_count,
  coalesce(sum(e.amount), 0)::numeric(14, 2) as total_amount,
  coalesce(sum(e.amount) filter (where e.is_void), 0)::numeric(14, 2) as voided_amount,
  coalesce(sum(case when e.is_void then 0::numeric else e.amount end), 0)::numeric(14, 2) as net_amount,
  coalesce(sum(e.tax_amount), 0)::numeric(14, 2) as total_tax_amount
from public.expense_heads as h
left join public.expenses as e on e.head_id = h.id
group by h.id, h.name, h.is_active;

comment on view public.expense_totals_by_head is
  'Spend grouped by expense head. Every head appears, including one with no expenses and one whose expenses were all voided, because a head nobody has used yet is still a head somebody will ask about.';

grant select on public.expense_ledger to authenticated;
grant select on public.expense_totals_by_head to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Writes
--
-- Three functions, all security definer with the role checked inside, no table grant
-- behind them. The same admin_/record_ split the rest of the project uses, except the
-- head catalogue is not admin_ prefixed: finance can maintain it, because a finance
-- officer who cannot name a head has to file rent under "Miscellaneous", and a
-- miscellaneous bucket is how a register stops being readable.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_expense_head(
  p_name text,
  p_description text default null,
  p_sort_order integer default null,
  p_head_id uuid default null
)
returns public.expense_heads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_description text := nullif(trim(p_description), '');
  saved_row public.expense_heads%rowtype;
begin
  if private.current_user_role() not in ('admin', 'finance') then
    raise exception 'Only finance can change an expense head';
  end if;

  if v_name is null then
    raise exception 'An expense head needs a name';
  end if;

  if char_length(v_name) > 120 then
    raise exception 'That expense head name is too long. 120 characters is the limit.';
  end if;

  if v_description is not null and char_length(v_description) > 240 then
    raise exception 'That description is too long. 240 characters is the limit.';
  end if;

  if p_head_id is null then
    if exists (select 1 from public.expense_heads where lower(name) = lower(v_name)) then
      raise exception 'An expense head called that already exists';
    end if;

    insert into public.expense_heads (name, description, sort_order, is_active)
    values (v_name, v_description, coalesce(p_sort_order, 0), true)
    returning * into saved_row;

    return saved_row;
  end if;

  if exists (
    select 1 from public.expense_heads
     where lower(name) = lower(v_name) and id <> p_head_id
  ) then
    raise exception 'An expense head called that already exists';
  end if;

  update public.expense_heads
     set name = v_name,
         description = v_description,
         sort_order = coalesce(p_sort_order, sort_order),
         is_active = true
   where id = p_head_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No expense head with that id';
  end if;

  return saved_row;
end;
$$;

comment on function public.upsert_expense_head(text, text, integer, uuid) is
  'Create or rename one expense head. Finance or admin. A rename is an update and not a delete-and-recreate, because expenses point at the row and replacing it would reparent every expense ever filed under that head. Refuses a name that already exists under a different spelling, so one head cannot fork into three.';

create or replace function public.set_expense_head_active(
  p_head_id uuid,
  p_is_active boolean
)
returns public.expense_heads
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.expense_heads%rowtype;
begin
  if private.current_user_role() not in ('admin', 'finance') then
    raise exception 'Only finance can change an expense head';
  end if;

  if not exists (select 1 from public.expense_heads where id = p_head_id) then
    raise exception 'No expense head with that id';
  end if;

  -- Retire only. There is no delete_expense_head(), and this is the reason: the
  -- foreign key is on delete restrict, so deleting a head with history under it
  -- would either fail with a constraint error or orphan the register. A head that
  -- nobody will ever use again is retired, and retirement is reversible.
  update public.expense_heads
     set is_active = p_is_active
   where id = p_head_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.set_expense_head_active(uuid, boolean) is
  'Retire or reinstate one expense head. Finance or admin. There is deliberately no delete: expenses reference the head, so a retired head keeps the grouping of everything already filed under it.';

create or replace function public.record_expense(
  p_head_id uuid,
  p_amount numeric,
  p_expense_date date default null,
  p_vendor text default null,
  p_mode public.payment_mode default 'bank_transfer',
  p_reference text default null,
  p_taxable_amount numeric default null,
  p_tax_amount numeric default null,
  p_attachment_path text default null,
  p_notes text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount numeric(14, 2);
  v_taxable numeric(14, 2);
  v_tax numeric(14, 2);
  v_vendor text := nullif(trim(p_vendor), '');
  v_reference text := nullif(trim(p_reference), '');
  v_notes text := nullif(trim(p_notes), '');
  v_attachment text := nullif(trim(p_attachment_path), '');
  saved_row public.expenses%rowtype;
begin
  if private.current_user_role() not in ('admin', 'finance') then
    raise exception 'Only finance can record expenses';
  end if;

  -- Rounded before anything is checked against it, so 100.005 stored as 100.01 does
  -- not then fail a tax-split comparison against an unrounded figure. Round first,
  -- validate second, in that order.
  if p_amount is null or p_amount = 'NaN'::numeric then
    raise exception 'Expense amount must be a positive number';
  end if;

  v_amount := round(p_amount, 2);

  if v_amount <= 0 then
    raise exception 'Expense amount must be a positive number';
  end if;

  -- The head has to be active. A retired head keeps its history, but filing a new
  -- expense against one would put a live row under a category the catalogue has
  -- withdrawn, which is the thing retirement exists to prevent.
  if not exists (
    select 1 from public.expense_heads where id = p_head_id and is_active
  ) then
    raise exception 'No active expense head with that id. Retire it from the register, or bring it back first.';
  end if;

  -- Tax split, normalised here rather than left to the constraint, so the caller gets
  -- the reason instead of a constraint name.
  if p_taxable_amount is null and p_tax_amount is null then
    v_taxable := null;
    v_tax := null;
  elsif p_taxable_amount is null or p_tax_amount is null then
    raise exception 'Give the taxable amount and the tax amount together, or neither';
  elsif p_taxable_amount = 'NaN'::numeric or p_tax_amount = 'NaN'::numeric
        or p_taxable_amount < 0 or p_tax_amount < 0 then
    raise exception 'Tax amounts cannot be negative';
  else
    v_taxable := round(p_taxable_amount, 2);
    v_tax := round(p_tax_amount, 2);

    if v_taxable + v_tax <> v_amount then
      raise exception 'The taxable amount and the tax amount add up to % but the expense is %',
        v_taxable + v_tax, v_amount;
    end if;
  end if;

  if v_vendor is not null and char_length(v_vendor) > 160 then
    raise exception 'That vendor name is too long. 160 characters is the limit.';
  end if;

  if v_reference is not null and char_length(v_reference) > 120 then
    raise exception 'That reference is too long. 120 characters is the limit.';
  end if;

  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'That note is too long. 500 characters is the limit.';
  end if;

  if v_attachment is not null and char_length(v_attachment) > 400 then
    raise exception 'That attachment path is too long. 400 characters is the limit.';
  end if;

  -- The date is bounded at the top only. Backdating an expense is ordinary -- the bill
  -- arrives on the 3rd for the month that ended on the 31st -- so a lower bound would
  -- refuse a legitimate entry. A date far in the future is a typo and is not a fact
  -- anybody can file, so it is refused.
  if coalesce(p_expense_date, private.business_date()) > private.business_date() then
    raise exception 'An expense cannot be dated in the future';
  end if;

  insert into public.expenses (
    head_id, expense_date, amount, vendor, mode, reference,
    taxable_amount, tax_amount, attachment_path, notes, recorded_by
  )
  values (
    p_head_id, coalesce(p_expense_date, private.business_date()), v_amount, v_vendor,
    coalesce(p_mode, 'bank_transfer'::public.payment_mode), v_reference,
    v_taxable, v_tax, v_attachment, v_notes, auth.uid()
  )
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.record_expense(uuid, numeric, date, text, public.payment_mode, text, numeric, numeric, text, text) is
  'File one general expense. Finance or admin. The row is final the moment it returns: there is no later edit, and the only correction is void_expense() plus a new row. An expense dated in the future is refused and a tax split that does not reconcile to the amount is refused before the insert rather than by the table.';

create or replace function public.void_expense(
  p_expense_id uuid,
  p_void_reason text
)
returns public.expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(p_void_reason), '');
  target_row public.expenses%rowtype;
  saved_row public.expenses%rowtype;
begin
  if private.current_user_role() not in ('admin', 'finance') then
    raise exception 'Only finance can void an expense';
  end if;

  if v_reason is null then
    raise exception 'An expense cannot be voided without a reason';
  end if;

  if char_length(v_reason) > 240 then
    raise exception 'That void reason is too long. 240 characters is the limit.';
  end if;

  select * into target_row
  from public.expenses
  where id = p_expense_id
  for update;

  if target_row.id is null then
    raise exception 'No expense with that id';
  end if;

  -- Not idempotent on purpose. A second void would overwrite who did it and when,
  -- which is the only record of who decided the expense was wrong. Failing loudly is
  -- also the answer to a double click.
  if target_row.is_void then
    raise exception 'That expense was already voided on %', target_row.voided_at;
  end if;

  update public.expenses
     set is_void = true,
         void_reason = v_reason,
         voided_by = auth.uid(),
         voided_at = now()
   where id = p_expense_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.void_expense(uuid, text) is
  'Write off one recorded expense: is_void plus a mandatory reason, the actor and the time. Finance or admin. This is the only way a recorded row stops counting, and it is not idempotent, so a second void raises rather than replacing the first one''s evidence. The row is kept so the register can still answer whether something was paid twice.';

-- ---------------------------------------------------------------------------
-- 5. Attachments
--
-- The first storage bucket in this project, and the only file storage for it. Private:
-- public is false, so no object is reachable by URL alone and the client has to mint a
-- signed one.
--
-- The expense id does not exist before the insert, and the client has no privilege to
-- insert the row, so there is no way to key the object by it. The client therefore
-- uploads first to a path it chooses -- YYYY/MM/<random>/<filename> -- and stores the
-- returned path on the row. That ordering is the cost of keeping the insert privilege
-- out of the client's hands, and it is why the file and the row cannot be written
-- together: if record_expense() then fails, an object is left with no row pointing at
-- it. Nothing can delete it, because there is no delete policy, so those are cleaned up
-- out of band. The alternative -- a storage path derived from the expense id -- was not
-- available for the same privilege reason.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-documents',
  'expense-documents',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Bills and receipts attached to public.expenses. Private by default and admin/finance
-- only: a vendor bill is as sensitive as the invoice beside it, and a signed URL that
-- expires is the only way out of here.
--
-- There is no comment on this bucket in the database, and that is not an oversight.
-- `comment on` addresses schema objects, and a bucket is a row in storage.buckets rather
-- than a schema object, so there is no statement that would attach text to it. The
-- description lives here, next to the insert that creates it.

drop policy if exists expense_documents_read_internal on storage.objects;
create policy expense_documents_read_internal
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'expense-documents'
    and private.current_user_role() in ('admin', 'finance')
  );

drop policy if exists expense_documents_insert_internal on storage.objects;
create policy expense_documents_insert_internal
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'expense-documents'
    and private.current_user_role() in ('admin', 'finance')
  );

-- There is no update policy and no delete policy, and the reason is worth more than the
-- two lines it takes.
--
-- Re-uploading a receipt does not need update. Each upload goes to a path carrying a
-- random segment, so a second upload of the same filename lands beside the first rather
-- than over it, and the row's attachment_path simply moves. Making the paths unique is
-- what removes the need for update; without that there would have been a reason to allow
-- it here.
--
-- Delete is absent on purpose rather than by omission. A receipt stays where it was put,
-- because the expense it explains is still in the register even after the entry is
-- voided, and a void is a statement that the money was not spent -- not that the evidence
-- should go away. An expense whose proof can be deleted is one whose amount is only ever
-- as trustworthy as whoever held the bucket key.

-- ---------------------------------------------------------------------------
-- 6. Permission catalogue
--
-- Two codes so the matrix screen has no blank row for the new screen, and one seeded
-- grant so the finance role's row reads correctly while the tier is still the one the
-- policies actually use. Nothing reads these yet, which 20261003150000 already records
-- as the state of the whole table.
-- ---------------------------------------------------------------------------

insert into public.permissions (code, name, description, group_name, sort_order) values
  ('finance.record_expenses', 'Record general expenses',
   'File an expense against a head, and void one that was recorded in error.', 'Finance', 50),
  ('finance.manage_expense_heads', 'Manage expense heads',
   'Add, rename and retire the categories that expenses are filed under.', 'Finance', 60)
on conflict (code) do nothing;

insert into public.role_permissions (role, permission_code)
values ('finance', 'finance.record_expenses'), ('finance', 'finance.manage_expense_heads')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.upsert_expense_head(text, text, integer, uuid) from public;
revoke all on function public.upsert_expense_head(text, text, integer, uuid) from anon;
revoke all on function public.set_expense_head_active(uuid, boolean) from public;
revoke all on function public.set_expense_head_active(uuid, boolean) from anon;
revoke all on function public.record_expense(uuid, numeric, date, text, public.payment_mode, text, numeric, numeric, text, text) from public;
revoke all on function public.record_expense(uuid, numeric, date, text, public.payment_mode, text, numeric, numeric, text, text) from anon;
revoke all on function public.void_expense(uuid, text) from public;
revoke all on function public.void_expense(uuid, text) from anon;

grant execute on function public.upsert_expense_head(text, text, integer, uuid) to authenticated;
grant execute on function public.set_expense_head_active(uuid, boolean) to authenticated;
grant execute on function public.record_expense(uuid, numeric, date, text, public.payment_mode, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
