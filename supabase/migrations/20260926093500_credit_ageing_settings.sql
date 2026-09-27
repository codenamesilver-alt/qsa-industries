-- Configurable invoice ageing, and a credit check that can be told which ages
-- count.
--
-- This answers the last open question in PRD section 11: "Specific fields
-- needed on the dealer credit-limit calculation (which invoice ages count, any
-- grace period)". The buckets are the reporting shape a credit manager actually
-- works in, and they are settings rather than code so the terms can change
-- without a deployment.
--
-- Semantics, chosen to be the conservative reading:
--
--   * Every outstanding invoice still counts toward exposure by default. Nothing
--     is forgiven silently.
--   * ageing_grace_days marks invoices that are still within terms. They are
--     reported as 'current' so a manager can see how much of the exposure is not
--     yet overdue.
--   * credit_counts_current_invoices = false is the switch that changes the
--     credit-limit decision: invoices still inside the grace period stop
--     counting, so a dealer inside terms gets the full limit back.
--
-- The bucket boundary columns are nullable: a null boundary switches that bucket
-- off, so a business that only tracks 0-30 and 30+ sets two and leaves the rest
-- empty.

alter table public.finance_settings
  add column if not exists ageing_grace_days integer not null default 0
    check (ageing_grace_days >= 0 and ageing_grace_days <= 365),
  add column if not exists ageing_bucket_1_days integer
    check (ageing_bucket_1_days is null or (ageing_bucket_1_days > 0 and ageing_bucket_1_days <= 365)),
  add column if not exists ageing_bucket_2_days integer
    check (ageing_bucket_2_days is null or (ageing_bucket_2_days > 0 and ageing_bucket_2_days <= 365)),
  add column if not exists ageing_bucket_3_days integer
    check (ageing_bucket_3_days is null or (ageing_bucket_3_days > 0 and ageing_bucket_3_days <= 365)),
  add column if not exists credit_counts_current_invoices boolean not null default true;

comment on column public.finance_settings.ageing_grace_days is
  'Days after invoice_date during which a payment is not yet overdue.';

comment on column public.finance_settings.credit_counts_current_invoices is
  'When false, invoices still inside the grace period do not count toward the credit limit.';

-- Guard the boundaries at write time. Two buckets that cross over would silently
-- swallow the invoices in between.
create or replace function private.validate_ageing_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ageing_bucket_1_days is not null
    and new.ageing_bucket_2_days is not null
    and new.ageing_bucket_1_days >= new.ageing_bucket_2_days then
    raise exception 'Ageing bucket 1 must be shorter than bucket 2';
  end if;

  if new.ageing_bucket_2_days is not null
    and new.ageing_bucket_3_days is not null
    and new.ageing_bucket_2_days >= new.ageing_bucket_3_days then
    raise exception 'Ageing bucket 2 must be shorter than bucket 3';
  end if;

  return new;
end;
$$;

drop trigger if exists finance_settings_validate_ageing on public.finance_settings;

create trigger finance_settings_validate_ageing
  before insert or update on public.finance_settings
  for each row
  execute function private.validate_ageing_settings();

-- ---------------------------------------------------------------------------
-- Outstanding balance per dealer, split by the configured buckets
-- ---------------------------------------------------------------------------

drop view if exists public.dealer_invoice_ageing;

create view public.dealer_invoice_ageing
with (security_invoker = true)
as
with settings as (
  select
    coalesce(ageing_grace_days, 0) as grace_days,
    ageing_bucket_1_days,
    ageing_bucket_2_days,
    ageing_bucket_3_days
  from public.finance_settings
  where id = true
),
open_invoices as (
  select
    i.id,
    i.dealer_id,
    i.invoice_number,
    i.invoice_date,
    i.total_amount - coalesce(sum(pa.amount), 0) as outstanding
  from public.invoices i
  left join public.payment_allocations pa on pa.invoice_id = i.id
  where private.can_view_dealer(i.dealer_id)
  group by i.id, i.dealer_id, i.invoice_number, i.invoice_date, i.total_amount
  having i.total_amount - coalesce(sum(pa.amount), 0) > 0
)
select
  oi.dealer_id,
  d.name as dealer_name,
  count(*) as open_invoice_count,
  coalesce(sum(oi.outstanding), 0) as total_outstanding,
  coalesce(
    sum(
      case
        when oi.invoice_date > private.business_date() - s.grace_days then oi.outstanding
        else 0
      end
    ),
    0
  ) as current_amount,
  coalesce(
    sum(
      case
        when oi.invoice_date <= private.business_date() - s.grace_days
         and (s.ageing_bucket_1_days is null
              or oi.invoice_date > private.business_date() - s.grace_days - s.ageing_bucket_1_days)
        then oi.outstanding
        else 0
      end
    ),
    0
  ) as bucket_1_amount,
  coalesce(
    sum(
      case
        when s.ageing_bucket_1_days is not null
         and oi.invoice_date <= private.business_date() - s.grace_days - s.ageing_bucket_1_days
         and (s.ageing_bucket_2_days is null
              or oi.invoice_date > private.business_date() - s.grace_days - s.ageing_bucket_1_days - s.ageing_bucket_2_days)
        then oi.outstanding
        else 0
      end
    ),
    0
  ) as bucket_2_amount,
  coalesce(
    sum(
      case
        when s.ageing_bucket_2_days is not null
         and oi.invoice_date <= private.business_date() - s.grace_days - s.ageing_bucket_1_days - s.ageing_bucket_2_days
         and (s.ageing_bucket_3_days is null
              or oi.invoice_date > private.business_date() - s.grace_days - s.ageing_bucket_1_days - s.ageing_bucket_2_days - s.ageing_bucket_3_days)
        then oi.outstanding
        else 0
      end
    ),
    0
  ) as bucket_3_amount,
  coalesce(
    sum(
      case
        when s.ageing_bucket_3_days is not null
         and oi.invoice_date <= private.business_date() - s.grace_days - s.ageing_bucket_1_days - s.ageing_bucket_2_days - s.ageing_bucket_3_days
        then oi.outstanding
        else 0
      end
    ),
    0
  ) as bucket_4_plus_amount
from open_invoices oi
cross join settings s
join public.dealers d on d.id = oi.dealer_id
group by oi.dealer_id, d.name;

grant select on public.dealer_invoice_ageing to authenticated;

-- ---------------------------------------------------------------------------
-- The credit check now honours the grace period
-- ---------------------------------------------------------------------------

create or replace function private.order_exposure(target_dealer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select
      coalesce(ageing_grace_days, 0) as grace_days,
      coalesce(credit_counts_current_invoices, true) as count_current
    from public.finance_settings
    where id = true
  ),
  invoice_balances as (
    select
      i.dealer_id,
      greatest(i.total_amount - coalesce(sum(pa.amount), 0), 0) as outstanding
    from public.invoices as i
    left join public.payment_allocations as pa on pa.invoice_id = i.id
    cross join settings as s
    where i.dealer_id = target_dealer_id
      -- Inside the grace period means still within terms, so it only stops
      -- counting when finance has explicitly asked for that.
      and (
        s.count_current
        or i.invoice_date <= (private.business_date() - s.grace_days)
      )
    group by i.id, i.dealer_id, i.total_amount
  ),
  invoice_totals as (
    select
      dealer_id,
      coalesce(sum(outstanding), 0) as invoice_outstanding
    from invoice_balances
    group by dealer_id
  ),
  advance_totals as (
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
  ),
  order_totals as (
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

-- ---------------------------------------------------------------------------
-- Writable settings, so the finance screen can change the terms
-- ---------------------------------------------------------------------------

create or replace function public.update_finance_settings(
  p_gst_rate numeric default null,
  p_company_state text default null,
  p_ageing_grace_days integer default null,
  p_ageing_bucket_1_days integer default null,
  p_ageing_bucket_2_days integer default null,
  p_ageing_bucket_3_days integer default null,
  p_credit_counts_current_invoices boolean default null,
  p_clear_ageing_buckets boolean default false
)
returns public.finance_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  current_row public.finance_settings%rowtype;
  updated_row public.finance_settings%rowtype;
begin
  actor_role := private.current_user_role();

  if actor_role is null or actor_role not in ('admin', 'finance') then
    raise exception 'Only finance can change finance settings';
  end if;

  select * into current_row from public.finance_settings where id = true;

  if current_row.id is null then
    insert into public.finance_settings (id) values (true) returning * into current_row;
  end if;

  -- A null argument means "leave this alone", which is what lets the screen send
  -- only the field the user actually edited. Clearing a bucket to switch it off
  -- is done with the dedicated clear flag rather than by sending null.
  update public.finance_settings
     set gst_rate = coalesce(p_gst_rate, gst_rate),
         company_state = case
           when p_company_state is null then company_state
           else nullif(trim(p_company_state), '')
         end,
         ageing_grace_days = coalesce(p_ageing_grace_days, ageing_grace_days),
         ageing_bucket_1_days = case
           when p_clear_ageing_buckets then null
           else coalesce(p_ageing_bucket_1_days, ageing_bucket_1_days)
         end,
         ageing_bucket_2_days = case
           when p_clear_ageing_buckets then null
           else coalesce(p_ageing_bucket_2_days, ageing_bucket_2_days)
         end,
         ageing_bucket_3_days = case
           when p_clear_ageing_buckets then null
           else coalesce(p_ageing_bucket_3_days, ageing_bucket_3_days)
         end,
         credit_counts_current_invoices = coalesce(
           p_credit_counts_current_invoices,
           credit_counts_current_invoices
         ),
         updated_at = now()
   where id = true
  returning * into updated_row;

  return updated_row;
end;
$$;

revoke all on function public.update_finance_settings(numeric, text, integer, integer, integer, integer, boolean, boolean) from public;
grant execute on function public.update_finance_settings(numeric, text, integer, integer, integer, integer, boolean, boolean) to authenticated;
