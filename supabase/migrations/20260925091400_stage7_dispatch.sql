create or replace function public.director_approve_order(
  target_order_id uuid,
  approval_remark text default null
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

  if actor_role is null or actor_role not in ('admin', 'sales_director') then
    raise exception 'Only sales directors can approve escalated orders';
  end if;

  if order_row.status <> 'pending_director_approval' then
    raise exception 'Order is not awaiting director approval';
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
    'approved',
    nullif(trim(approval_remark), ''),
    private.order_exposure(order_row.dealer_id),
    private.order_exposure(order_row.dealer_id)
  );

  update public.orders
  set status = 'approved',
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

create or replace function public.director_reject_order(
  target_order_id uuid,
  rejection_remark text
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

  if actor_role is null or actor_role not in ('admin', 'sales_director') then
    raise exception 'Only sales directors can reject escalated orders';
  end if;

  if order_row.status not in ('pending', 'pending_director_approval') then
    raise exception 'Order cannot be rejected from its current status';
  end if;

  if nullif(trim(rejection_remark), '') is null then
    raise exception 'A rejection remark is required';
  end if;

  insert into public.order_approvals (order_id, actor_id, action, remark)
  values (order_row.id, (select auth.uid()), 'rejected', trim(rejection_remark));

  update public.orders
  set status = 'rejected'
  where id = order_row.id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

create or replace function public.dispatch_order(
  target_order_id uuid,
  dispatch_date_value date default private.business_date(),
  dispatch_note text default null
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

  if actor_role is null or actor_role not in ('admin', 'logistics') then
    raise exception 'Only logistics can dispatch orders';
  end if;

  if order_row.status <> 'approved' then
    raise exception 'Only approved orders can be dispatched';
  end if;

  if dispatch_date_value is null then
    raise exception 'Dispatch date is required';
  end if;

  perform 1
  from public.dealers
  where id = order_row.dealer_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'Dealer account is not active';
  end if;

  update public.orders
  set status = 'dispatched',
      dispatch_date = dispatch_date_value,
      dispatched_at = now(),
      tracking_note = nullif(trim(dispatch_note), '')
  where id = order_row.id;

  insert into public.stock_movements (
    product_id,
    quantity,
    movement_type,
    source,
    reference_id,
    reason,
    created_by
  )
  select
    oi.product_id,
    oi.quantity,
    'out',
    'sales',
    order_row.id,
    'Order dispatch',
    (select auth.uid())
  from public.order_items as oi
  where oi.order_id = order_row.id
  order by oi.product_id;

  select *
  into order_row
  from public.orders
  where id = target_order_id;

  return order_row;
end;
$$;

revoke all on function public.director_approve_order(uuid, text) from public;
revoke all on function public.director_reject_order(uuid, text) from public;
revoke all on function public.dispatch_order(uuid, date, text) from public;
grant execute on function public.director_approve_order(uuid, text) to authenticated;
grant execute on function public.director_reject_order(uuid, text) to authenticated;
grant execute on function public.dispatch_order(uuid, date, text) to authenticated;
