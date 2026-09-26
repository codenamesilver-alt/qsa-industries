create type public.payment_mode as enum ('cash', 'bank_transfer', 'upi', 'cheque', 'other');
create sequence public.invoice_number_seq start with 1001;

revoke all on sequence public.invoice_number_seq from public, anon, authenticated;

create table public.finance_settings (
  id boolean primary key default true,
   gst_rate numeric(5, 4) not null default 0.18 check (gst_rate >= 0 and gst_rate <= 1 and gst_rate <> 'NaN'::numeric),
  updated_at timestamptz not null default now()
);

insert into public.finance_settings (id, gst_rate)
values (true, 0.18)
on conflict (id) do update set gst_rate = excluded.gst_rate;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  dealer_id uuid not null references public.dealers (id) on delete restrict,
  invoice_number text not null unique,
   taxable_amount numeric(14, 2) not null check (taxable_amount >= 0 and taxable_amount <> 'NaN'::numeric),
   gst_amount numeric(14, 2) not null check (gst_amount >= 0 and gst_amount <> 'NaN'::numeric),
   total_amount numeric(14, 2) not null check (total_amount >= 0 and total_amount <> 'NaN'::numeric),
  invoice_date date not null default private.business_date(),
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices (id) on delete restrict,
  dealer_id uuid references public.dealers (id) on delete restrict,
   amount numeric(14, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  payment_date date not null default private.business_date(),
  mode public.payment_mode not null,
  reference text,
  recorded_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint payment_target_present check (invoice_id is not null or dealer_id is not null)
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0 and amount <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  constraint payment_allocation_unique unique (payment_id, invoice_id)
);

create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id, created_at desc);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id, created_at desc);

create or replace function private.validate_payment_dealer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_dealer_id uuid;
begin
  if new.invoice_id is not null then
    select i.dealer_id
    into invoice_dealer_id
    from public.invoices as i
    where i.id = new.invoice_id;

    if invoice_dealer_id is null then
      raise exception 'Invoice % does not exist', new.invoice_id;
    end if;

    if new.dealer_id is distinct from invoice_dealer_id then
      raise exception 'Payment dealer must match invoice dealer';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists payments_validate_dealer on public.payments;
create trigger payments_validate_dealer
before insert or update of invoice_id, dealer_id on public.payments
for each row
execute function private.validate_payment_dealer();

revoke all on function private.validate_payment_dealer() from public;

create or replace function private.validate_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_dealer_id uuid;
  payment_invoice_id uuid;
  invoice_dealer_id uuid;
begin
  select p.dealer_id, p.invoice_id
  into payment_dealer_id, payment_invoice_id
  from public.payments as p
  where p.id = new.payment_id;

  if not found then
    raise exception 'Payment % does not exist', new.payment_id;
  end if;

  select i.dealer_id
  into invoice_dealer_id
  from public.invoices as i
  where i.id = new.invoice_id;

  if invoice_dealer_id is null then
    raise exception 'Invoice % does not exist', new.invoice_id;
  end if;

  if payment_dealer_id is distinct from invoice_dealer_id then
    raise exception 'Payment allocation dealer must match invoice dealer';
  end if;

  if payment_invoice_id is not null and payment_invoice_id is distinct from new.invoice_id then
    raise exception 'Payment allocation must match payment invoice';
  end if;

  return new;
end;
$$;

drop trigger if exists payment_allocations_validate_target on public.payment_allocations;
create trigger payment_allocations_validate_target
before insert or update of payment_id, invoice_id on public.payment_allocations
for each row
execute function private.validate_payment_allocation();

revoke all on function private.validate_payment_allocation() from public;

create or replace function private.order_exposure(target_dealer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with invoice_balances as (
    select
      i.dealer_id,
      greatest(i.total_amount - coalesce(sum(pa.amount), 0), 0) as outstanding
    from public.invoices as i
    left join public.payment_allocations as pa on pa.invoice_id = i.id
    where i.dealer_id = target_dealer_id
    group by i.id, i.dealer_id, i.total_amount
  ), invoice_totals as (
    select
      dealer_id,
      coalesce(sum(outstanding), 0) as invoice_outstanding
    from invoice_balances
    group by dealer_id
  ), advance_totals as (
    select
      balances.dealer_id,
      coalesce(sum(balances.available_amount), 0) as advance_balance
    from (
      select
        p.dealer_id,
        p.amount - coalesce(sum(pa.amount), 0) as available_amount
      from public.payments as p
      left join public.payment_allocations as pa on pa.payment_id = p.id
      where p.dealer_id = target_dealer_id
        and p.invoice_id is null
      group by p.id, p.dealer_id, p.amount
      having p.amount - coalesce(sum(pa.amount), 0) > 0
    ) as balances
    group by balances.dealer_id
  ), order_totals as (
    select
      o.dealer_id,
      coalesce(sum(o.total_amount), 0) as order_exposure
    from public.orders as o
    where o.dealer_id = target_dealer_id
      and o.status in ('pending', 'pending_director_approval', 'approved')
    group by o.dealer_id
  )
  select
    coalesce((select order_exposure from order_totals), 0)
      + greatest(
        coalesce((select invoice_outstanding from invoice_totals), 0)
          - coalesce((select advance_balance from advance_totals), 0),
        0
      )
$$;

alter table public.orders
  add column if not exists invoice_id uuid references public.invoices (id) on delete set null;

create index invoices_dealer_date_idx on public.invoices (dealer_id, invoice_date desc);
create index payments_invoice_idx on public.payments (invoice_id, payment_date desc);
create index payments_dealer_idx on public.payments (dealer_id, payment_date desc);

create or replace function public.generate_invoice(target_order_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  invoice_row public.invoices%rowtype;
  actor_role public.user_role;
  configured_gst_rate numeric(5, 4);
  calculated_taxable numeric(14, 2);
  calculated_gst numeric(14, 2);
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can generate invoices';
  end if;

  select *
  into order_row
  from public.orders
  where id = target_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  if order_row.status <> 'dispatched' then
    raise exception 'Only dispatched orders can be invoiced';
  end if;

  if order_row.invoice_id is not null then
    raise exception 'Order already has an invoice';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
  for update;

  select gst_rate
  into configured_gst_rate
  from public.finance_settings
  where id = true;

  configured_gst_rate := coalesce(configured_gst_rate, 0.18);
  calculated_taxable := round(order_row.total_amount / (1 + configured_gst_rate), 2);
  calculated_gst := round(order_row.total_amount - calculated_taxable, 2);

  insert into public.invoices (
    order_id,
    dealer_id,
    invoice_number,
    taxable_amount,
    gst_amount,
    total_amount,
    created_by
  )
  values (
    order_row.id,
    order_row.dealer_id,
    'QSA-' || to_char(private.business_date(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0'),
    calculated_taxable,
    calculated_gst,
    order_row.total_amount,
    (select auth.uid())
  )
  returning * into invoice_row;

  update public.orders
  set status = 'invoiced',
      invoice_id = invoice_row.id
  where id = order_row.id;

  return invoice_row;
end;
$$;

create or replace function public.record_invoice_payment(
  target_invoice_id uuid,
  payment_amount numeric,
  payment_date_value date default private.business_date(),
  payment_mode_value public.payment_mode default 'bank_transfer',
  payment_reference text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices%rowtype;
  payment_row public.payments%rowtype;
  excess_row public.payments%rowtype;
  advance_row record;
  advance_used numeric(14, 2) := 0;
  advance_available numeric(14, 2);
  allocated_amount numeric(14, 2);
  cash_needed numeric(14, 2);
  excess_amount numeric(14, 2);
  invoice_target numeric(14, 2);
  remaining_target numeric(14, 2);
  outstanding numeric(14, 2);
  first_advance_id uuid;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can record payments';
  end if;

  if payment_amount is null or payment_amount <= 0 or payment_amount = 'NaN'::numeric then
    raise exception 'Payment amount must be positive';
  end if;

  payment_amount := round(payment_amount, 2);

  if payment_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select *
  into invoice_row
  from public.invoices
  where id = target_invoice_id
  for update;

  if invoice_row.id is null then
    raise exception 'Invoice % was not found', target_invoice_id;
  end if;

  perform 1
  from public.dealers
  where id = invoice_row.dealer_id
  for update;

  select greatest(i.total_amount - coalesce(sum(pa.amount), 0), 0)
  into outstanding
  from public.invoices as i
  left join public.payment_allocations as pa on pa.invoice_id = i.id
    where i.id = target_invoice_id
    group by i.total_amount;

  if outstanding <= 0 then
    raise exception 'Invoice has no outstanding balance';
  end if;

  select coalesce(sum(balance.available_amount), 0)
  into advance_available
  from (
    select p.amount - coalesce(sum(pa.amount), 0) as available_amount
    from public.payments as p
    left join public.payment_allocations as pa on pa.payment_id = p.id
    where p.dealer_id = invoice_row.dealer_id
      and p.invoice_id is null
    group by p.id, p.amount
    having p.amount - coalesce(sum(pa.amount), 0) > 0
  ) as balance;

  if payment_amount > outstanding + advance_available then
    raise exception 'Payment exceeds outstanding invoice and advance balance';
  end if;

  invoice_target := least(payment_amount, outstanding);
  remaining_target := invoice_target;

  while remaining_target > 0 loop
    select
      p.id,
      p.amount - coalesce(sum(pa.amount), 0) as available_amount
    into advance_row
    from public.payments as p
    left join public.payment_allocations as pa on pa.payment_id = p.id
    where p.dealer_id = invoice_row.dealer_id
      and p.invoice_id is null
    group by p.id, p.amount
    having p.amount - coalesce(sum(pa.amount), 0) > 0
    order by p.created_at, p.id
    limit 1;

    exit when not found;

    allocated_amount := least(remaining_target, advance_row.available_amount);
    first_advance_id := coalesce(first_advance_id, advance_row.id);

    insert into public.payment_allocations (payment_id, invoice_id, amount)
    values (advance_row.id, invoice_row.id, allocated_amount);

    advance_used := advance_used + allocated_amount;
    remaining_target := remaining_target - allocated_amount;
  end loop;

  cash_needed := invoice_target - advance_used;

  if cash_needed > 0 then
    insert into public.payments (
      invoice_id,
      dealer_id,
      amount,
      payment_date,
      mode,
      reference,
      recorded_by
    )
    values (
      invoice_row.id,
      invoice_row.dealer_id,
      cash_needed,
      coalesce(payment_date_value, private.business_date()),
      payment_mode_value,
      nullif(trim(payment_reference), ''),
      (select auth.uid())
    )
    returning * into payment_row;

    insert into public.payment_allocations (payment_id, invoice_id, amount)
    values (payment_row.id, invoice_row.id, cash_needed);
  end if;

  excess_amount := payment_amount - invoice_target;

  if excess_amount > 0 then
    insert into public.payments (
      dealer_id,
      amount,
      payment_date,
      mode,
      reference,
      recorded_by
    )
    values (
      invoice_row.dealer_id,
      excess_amount,
      coalesce(payment_date_value, private.business_date()),
      payment_mode_value,
      nullif(trim(payment_reference), ''),
      (select auth.uid())
    )
    returning * into excess_row;
  end if;

  if payment_row.id is null and excess_row.id is not null then
    payment_row := excess_row;
  end if;

  if payment_row.id is null and first_advance_id is not null then
    select *
    into payment_row
    from public.payments
    where id = first_advance_id;
  end if;

  if payment_row.id is null then
    raise exception 'Payment could not be recorded';
  end if;

  return payment_row;
end;
$$;

create or replace function public.record_dealer_payment(
  target_dealer_id uuid,
  payment_amount numeric,
  payment_date_value date default private.business_date(),
  payment_mode_value public.payment_mode default 'bank_transfer',
  payment_reference text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments%rowtype;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can record payments';
  end if;

  if payment_amount is null or payment_amount <= 0 or payment_amount = 'NaN'::numeric then
    raise exception 'Payment amount must be positive';
  end if;

  payment_amount := round(payment_amount, 2);

  if payment_amount <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  perform 1
  from public.dealers
  where id = target_dealer_id
  for update;

  if not found then
    raise exception 'Dealer % was not found', target_dealer_id;
  end if;

  insert into public.payments (
    dealer_id,
    amount,
    payment_date,
    mode,
    reference,
    recorded_by
  )
  values (
    target_dealer_id,
    payment_amount,
    coalesce(payment_date_value, private.business_date()),
    payment_mode_value,
    nullif(trim(payment_reference), ''),
    (select auth.uid())
  )
  returning * into payment_row;

  return payment_row;
end;
$$;

create or replace function public.dealer_credit_summary(target_dealer_id uuid)
returns table (
  dealer_id uuid,
  credit_limit numeric,
  outstanding_invoices numeric,
  available_credit numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with invoice_balances as (
    select
      i.id,
      i.dealer_id,
      greatest(i.total_amount - coalesce(sum(pa.amount), 0), 0) as outstanding
    from public.invoices as i
    left join public.payment_allocations as pa on pa.invoice_id = i.id
    group by i.id, i.dealer_id, i.total_amount
  ), invoice_totals as (
    select
      dealer_id,
      coalesce(sum(outstanding), 0) as invoice_outstanding
    from invoice_balances
    group by dealer_id
  ), advance_totals as (
    select
      balances.dealer_id,
      coalesce(sum(balances.available_amount), 0) as advance_balance
    from (
      select
        p.dealer_id,
        p.amount - coalesce(sum(pa.amount), 0) as available_amount
      from public.payments as p
      left join public.payment_allocations as pa on pa.payment_id = p.id
      where p.dealer_id is not null
        and p.invoice_id is null
      group by p.id, p.dealer_id, p.amount
      having p.amount - coalesce(sum(pa.amount), 0) > 0
    ) as balances
    group by balances.dealer_id
  ), order_totals as (
    select
      o.dealer_id,
      coalesce(sum(o.total_amount) filter (
        where o.status in ('pending', 'pending_director_approval', 'approved')
      ), 0) as order_exposure
    from public.orders as o
    group by o.dealer_id
  ), dealer_balances as (
    select
      d.id as dealer_id,
      coalesce(d.credit_limit_override, d.credit_limit, 0) as credit_limit,
      greatest(
        coalesce(it.invoice_outstanding, 0) - coalesce(at.advance_balance, 0),
        0
      ) as outstanding_invoices,
      coalesce(ot.order_exposure, 0) as order_exposure
    from public.dealers as d
    left join invoice_totals as it on it.dealer_id = d.id
    left join advance_totals as at on at.dealer_id = d.id
    left join order_totals as ot on ot.dealer_id = d.id
  )
  select
    dealer_id,
    credit_limit,
    outstanding_invoices,
    greatest(credit_limit - outstanding_invoices - order_exposure, 0)
  from dealer_balances
  where dealer_id = target_dealer_id
    and (
      private.current_user_role() in ('admin', 'finance')
      or private.can_view_dealer(dealer_id)
    )
$$;

create or replace view public.dealer_ledger
with (security_invoker = true)
as
select
  i.id as invoice_id,
  i.invoice_number,
  i.dealer_id,
  i.invoice_date,
  i.total_amount,
  coalesce(sum(pa.amount), 0) as paid_amount,
  i.total_amount - coalesce(sum(pa.amount), 0) as outstanding_amount
from public.invoices as i
left join public.payment_allocations as pa on pa.invoice_id = i.id
group by i.id, i.invoice_number, i.dealer_id, i.invoice_date, i.total_amount;

alter table public.finance_settings enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;

revoke all on table public.finance_settings, public.invoices, public.payments, public.payment_allocations from anon, authenticated;
grant select on table public.finance_settings, public.invoices, public.payments, public.payment_allocations to authenticated;
grant select on public.dealer_ledger to authenticated;

drop policy if exists finance_settings_select_internal on public.finance_settings;
create policy finance_settings_select_internal
on public.finance_settings
for select
to authenticated
using (private.current_user_role() in ('admin', 'finance'));

drop policy if exists invoices_select_scope on public.invoices;
create policy invoices_select_scope
on public.invoices
for select
to authenticated
using (
  private.current_user_role() in ('admin', 'finance')
  or private.can_view_dealer(dealer_id)
);

drop policy if exists payments_select_scope on public.payments;
create policy payments_select_scope
on public.payments
for select
to authenticated
using (
  private.current_user_role() in ('admin', 'finance')
  or (dealer_id is not null and private.can_view_dealer(dealer_id))
);

drop policy if exists payment_allocations_select_scope on public.payment_allocations;
create policy payment_allocations_select_scope
on public.payment_allocations
for select
to authenticated
using (
  private.current_user_role() in ('admin', 'finance')
  or exists (
    select 1
    from public.invoices as i
    where i.id = payment_allocations.invoice_id
      and private.can_view_dealer(i.dealer_id)
  )
);

revoke all on function public.generate_invoice(uuid) from public;
revoke all on function public.record_invoice_payment(uuid, numeric, date, public.payment_mode, text) from public;
revoke all on function public.record_dealer_payment(uuid, numeric, date, public.payment_mode, text) from public;
revoke all on function public.dealer_credit_summary(uuid) from public;
grant execute on function public.generate_invoice(uuid) to authenticated;
grant execute on function public.record_invoice_payment(uuid, numeric, date, public.payment_mode, text) to authenticated;
grant execute on function public.record_dealer_payment(uuid, numeric, date, public.payment_mode, text) to authenticated;
grant execute on function public.dealer_credit_summary(uuid) to authenticated;
