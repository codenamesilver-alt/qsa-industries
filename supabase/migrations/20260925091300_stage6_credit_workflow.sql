create type public.order_approval_action as enum ('approved', 'override', 'escalated', 'rejected');

create table public.order_approvals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  actor_id uuid not null references public.users (id) on delete restrict,
  action public.order_approval_action not null,
  remark text,
  credit_limit numeric(14, 2),
  exposure_before numeric(14, 2),
  exposure_after numeric(14, 2),
  created_at timestamptz not null default now()
);

create index order_approvals_order_created_idx on public.order_approvals (order_id, created_at desc);

create or replace function private.order_exposure(target_dealer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(o.total_amount), 0)
  from public.orders as o
  where o.dealer_id = target_dealer_id
    and o.status in ('pending', 'pending_director_approval', 'approved')
$$;

create or replace function public.credit_summary(target_dealer_id uuid)
returns table (
  dealer_id uuid,
  credit_limit numeric,
  exposure numeric,
  available_credit numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    coalesce(d.credit_limit_override, d.credit_limit),
    private.order_exposure(d.id),
    coalesce(d.credit_limit_override, d.credit_limit) - private.order_exposure(d.id)
  from public.dealers as d
  where d.id = target_dealer_id
    and (
      private.current_user_role() in ('admin', 'finance')
      or private.can_view_dealer(d.id)
    )
$$;

create or replace function private.assert_order_stock_available(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row record;
  available_quantity numeric(14, 2);
begin
  for item_row in
    select product_id, sum(quantity)::numeric(14, 2) as required_quantity
    from public.order_items
    where order_id = target_order_id
    group by product_id
    order by product_id
  loop
    select current_quantity
    into available_quantity
    from public.stock_levels
    where product_id = item_row.product_id
    for update;

    if not found or coalesce(available_quantity, 0) < item_row.required_quantity then
      raise exception 'Insufficient stock for product % while approving order %',
        item_row.product_id,
        target_order_id;
    end if;
  end loop;
end;
$$;

create or replace function public.approve_order(
  target_order_id uuid,
  approval_remark text default null,
  use_override boolean default false
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  actor_role public.user_role;
  dealer_limit numeric(14, 2);
  exposure_before numeric(14, 2);
  exposure_without_order numeric(14, 2);
begin
  actor_role := private.current_user_role();

  select *
  into order_row
  from public.orders
  where id = target_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  if actor_role is null
    or actor_role not in ('admin', 'sales_manager', 'sales_director')
    or (actor_role = 'sales_manager' and not private.can_view_dealer(order_row.dealer_id)) then
    raise exception 'You cannot approve orders for this dealer';
  end if;

  if order_row.status <> 'pending' then
    raise exception 'Only pending orders can be approved';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Dealer account is not active';
  end if;

  perform private.assert_order_stock_available(order_row.id);

  select coalesce(credit_limit_override, credit_limit, 0)
  into dealer_limit
  from public.dealers
  where id = order_row.dealer_id;

  exposure_before := private.order_exposure(order_row.dealer_id);
  exposure_without_order := greatest(exposure_before - order_row.total_amount, 0);

  if use_override and nullif(trim(approval_remark), '') is null then
    raise exception 'A remark is required for a credit override';
  end if;

  if exposure_without_order + order_row.total_amount > dealer_limit and not use_override then
    raise exception 'Credit limit exceeded; use an override with a remark or escalate';
  end if;

  insert into public.order_approvals (
    order_id,
    actor_id,
    action,
    remark,
    credit_limit,
    exposure_before,
    exposure_after
  )
  values (
    order_row.id,
    (select auth.uid()),
    case when use_override then 'override'::public.order_approval_action else 'approved'::public.order_approval_action end,
    nullif(trim(approval_remark), ''),
    dealer_limit,
    exposure_before,
    exposure_without_order + order_row.total_amount
  );

  update public.orders
  set status = 'approved',
      credit_override = use_override,
      approved_by = (select auth.uid()),
      approved_at = now()
  where id = order_row.id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

create or replace function public.escalate_order(
  target_order_id uuid,
  escalation_remark text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  actor_role public.user_role;
begin
  actor_role := private.current_user_role();

  select *
  into order_row
  from public.orders
  where id = target_order_id
  for update;

  if order_row.id is null then
    raise exception 'Order % was not found', target_order_id;
  end if;

  if actor_role is null
    or actor_role not in ('admin', 'sales_manager', 'sales_director')
    or (actor_role = 'sales_manager' and not private.can_view_dealer(order_row.dealer_id)) then
    raise exception 'You cannot escalate orders for this dealer';
  end if;

  if order_row.status <> 'pending' then
    raise exception 'Only pending orders can be escalated';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Dealer account is not active';
  end if;

  if nullif(trim(escalation_remark), '') is null then
    raise exception 'An escalation remark is required';
  end if;

  insert into public.order_approvals (
    order_id,
    actor_id,
    action,
    remark,
    exposure_before,
    exposure_after
  )
  values (
    order_row.id,
    (select auth.uid()),
    'escalated',
    nullif(trim(escalation_remark), ''),
    private.order_exposure(order_row.dealer_id),
    private.order_exposure(order_row.dealer_id)
  );

  update public.orders
  set status = 'pending_director_approval'
  where id = order_row.id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

alter table public.order_approvals enable row level security;
revoke all on table public.order_approvals from anon, authenticated;
grant select on table public.order_approvals to authenticated;

drop policy if exists order_approvals_select_scope on public.order_approvals;
create policy order_approvals_select_scope
on public.order_approvals
for select
to authenticated
using (
  exists (
    select 1
    from public.orders as o
    where o.id = order_approvals.order_id
  )
);

revoke all on function private.order_exposure(uuid) from public;
revoke all on function private.assert_order_stock_available(uuid) from public;
revoke all on function public.credit_summary(uuid) from public;
revoke all on function public.approve_order(uuid, text, boolean) from public;
revoke all on function public.escalate_order(uuid, text) from public;
grant execute on function public.credit_summary(uuid) to authenticated;
grant execute on function public.approve_order(uuid, text, boolean) to authenticated;
grant execute on function public.escalate_order(uuid, text) to authenticated;
