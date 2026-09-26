create type public.order_status as enum (
  'pending',
  'approved',
  'pending_director_approval',
  'dispatched',
  'invoiced',
  'rejected'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealers (id) on delete restrict,
  sales_rep_id uuid not null references public.users (id) on delete restrict,
  status public.order_status not null default 'pending',
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0 and total_amount <> 'NaN'::numeric),
  credit_override boolean not null default false,
  created_by uuid not null references public.users (id) on delete restrict,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  dispatch_date date,
  dispatched_at timestamptz,
  tracking_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14, 2) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  unit_price numeric(14, 2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  line_total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now()
);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  actor_id uuid references public.users (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index orders_dealer_created_idx on public.orders (dealer_id, created_at desc);
create index orders_sales_rep_status_idx on public.orders (sales_rep_id, status);
create index order_items_order_idx on public.order_items (order_id);
create index order_events_order_created_idx on public.order_events (order_id, created_at);

create or replace function private.assign_order_sales_rep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_rep_id uuid;
begin
  select d.sales_rep_id
  into mapped_rep_id
  from public.dealers as d
  where d.id = new.dealer_id;

  if mapped_rep_id is null then
    raise exception 'Dealer % has no mapped sales representative', new.dealer_id;
  end if;

  if new.sales_rep_id is null or private.current_user_role() = 'dealer' then
    new.sales_rep_id := mapped_rep_id;
  end if;

  return new;
end;
$$;

create or replace function private.recalculate_order_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.orders
    set total_amount = coalesce((
      select sum(line_total)
      from public.order_items
      where order_id = old.order_id
    ), 0)
    where id = old.order_id;
    return old;
  end if;

  update public.orders
  set total_amount = coalesce((
    select sum(line_total)
    from public.order_items
    where order_id = new.order_id
  ), 0)
  where id = new.order_id;

  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    update public.orders
    set total_amount = coalesce((
      select sum(line_total)
      from public.order_items
      where order_id = old.order_id
    ), 0)
    where id = old.order_id;
  end if;

  return new;
end;
$$;

create or replace function private.record_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    insert into public.order_events (order_id, status, actor_id, note)
    values (new.id, new.status, (select auth.uid()), null);
  end if;

  return new;
end;
$$;

create trigger orders_assign_sales_rep
before insert on public.orders
for each row
execute function private.assign_order_sales_rep();

create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

create trigger order_items_recalculate_total
after insert or update or delete on public.order_items
for each row
execute function private.recalculate_order_total();

create trigger orders_record_event
after insert or update of status on public.orders
for each row
execute function private.record_order_event();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

revoke all on table public.orders, public.order_items, public.order_events from anon, authenticated;
grant select on table public.orders, public.order_items, public.order_events to authenticated;

drop policy if exists orders_select_scope on public.orders;
create policy orders_select_scope
on public.orders
for select
to authenticated
using (
  private.current_user_role() in ('admin', 'logistics', 'finance')
  or private.can_view_dealer(dealer_id)
);

drop policy if exists order_items_select_scope on public.order_items;
create policy order_items_select_scope
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders as o
    where o.id = order_items.order_id
  )
);

revoke all on function private.assign_order_sales_rep() from public;
revoke all on function private.recalculate_order_total() from public;
revoke all on function private.record_order_event() from public;

drop policy if exists order_events_select_scope on public.order_events;
create policy order_events_select_scope
on public.order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders as o
    where o.id = order_events.order_id
  )
);
