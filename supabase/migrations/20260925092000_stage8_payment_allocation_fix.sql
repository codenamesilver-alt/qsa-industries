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
    values (advance_row.id, invoice_row.id, allocated_amount)
    on conflict (payment_id, invoice_id)
    do update set amount = payment_allocations.amount + excluded.amount;

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
    values (payment_row.id, invoice_row.id, cash_needed)
    on conflict (payment_id, invoice_id)
    do update set amount = payment_allocations.amount + excluded.amount;
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
