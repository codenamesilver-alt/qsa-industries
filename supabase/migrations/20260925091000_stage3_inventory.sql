alter table public.products
  add column if not exists low_stock_threshold numeric(14, 2) not null default 0;

alter table public.products
  drop constraint if exists products_low_stock_threshold_check;
alter table public.products
  add constraint products_low_stock_threshold_check
  check (low_stock_threshold >= 0 and low_stock_threshold <> 'NaN'::numeric);

update public.products
set low_stock_threshold = case sku
  when 'QSA-LAYER-01' then 500
  when 'QSA-LAYER-02' then 400
  when 'QSA-BROILER-01' then 350
  when 'QSA-BROILER-02' then 300
  when 'QSA-GROWER-01' then 450
  else low_stock_threshold
end
where low_stock_threshold = 0;

create type public.stock_movement_type as enum ('in', 'out');
create type public.stock_movement_source as enum ('production', 'sales', 'adjustment');

create table public.stock_levels (
  product_id uuid primary key references public.products (id) on delete cascade,
  current_quantity numeric(14, 2) not null default 0 check (current_quantity >= 0 and current_quantity <> 'NaN'::numeric),
  unit text not null check (char_length(trim(unit)) > 0),
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14, 2) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  movement_type public.stock_movement_type not null,
  source public.stock_movement_source not null,
  reference_id uuid,
  reason text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index stock_movements_product_created_idx
  on public.stock_movements (product_id, created_at desc);
create index stock_movements_reference_idx
  on public.stock_movements (reference_id);

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  available_quantity numeric(14, 2);
  product_unit text;
begin
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;

  select p.unit_of_measure
  into product_unit
  from public.products as p
  where p.id = new.product_id;

  if product_unit is null then
    raise exception 'Product % does not exist', new.product_id;
  end if;

  insert into public.stock_levels (product_id, current_quantity, unit)
  values (new.product_id, 0, product_unit)
  on conflict (product_id) do nothing;

  select current_quantity
  into available_quantity
  from public.stock_levels
  where product_id = new.product_id
  for update;

  if new.movement_type = 'out' and available_quantity < new.quantity then
    raise exception 'Insufficient stock for product %: available %, requested %',
      new.product_id,
      available_quantity,
      new.quantity;
  end if;

  update public.stock_levels
  set current_quantity = case
        when new.movement_type = 'in' then current_quantity + new.quantity
        else current_quantity - new.quantity
      end,
      updated_at = now()
  where product_id = new.product_id;

  return new;
end;
$$;

create trigger stock_movements_apply_level
after insert on public.stock_movements
for each row
execute function private.apply_stock_movement();

create trigger stock_levels_set_updated_at
before update on public.stock_levels
for each row
execute function public.set_updated_at();

insert into public.stock_levels (product_id, current_quantity, unit)
values
  ('30000000-0000-4000-8000-000000000001', 1200, 'kg'),
  ('30000000-0000-4000-8000-000000000002', 950, 'kg'),
  ('30000000-0000-4000-8000-000000000003', 780, 'kg'),
  ('30000000-0000-4000-8000-000000000004', 640, 'kg'),
  ('30000000-0000-4000-8000-000000000005', 1100, 'kg')
on conflict (product_id) do update
set current_quantity = excluded.current_quantity,
    unit = excluded.unit;

alter table public.stock_levels enable row level security;
alter table public.stock_movements enable row level security;

revoke all on table public.stock_levels, public.stock_movements from anon, authenticated;
grant select on table public.stock_levels, public.stock_movements to authenticated;
grant update (low_stock_threshold) on table public.products to authenticated;

drop policy if exists products_update_threshold on public.products;
create policy products_update_threshold
on public.products
for update
to authenticated
using (private.current_user_role() in ('admin', 'inventory_manager'))
with check (private.current_user_role() in ('admin', 'inventory_manager'));

drop policy if exists stock_levels_select_scope on public.stock_levels;
create policy stock_levels_select_scope
on public.stock_levels
for select
to authenticated
using (
  private.current_user_role() in (
    'admin',
    'production_manager',
    'inventory_manager',
    'logistics',
    'finance'
  )
  or exists (
    select 1
    from public.products as p
    where p.id = product_id
      and p.active
  )
);

drop policy if exists stock_movements_select_scope on public.stock_movements;
create policy stock_movements_select_scope
on public.stock_movements
for select
to authenticated
using (
  private.current_user_role() in (
    'admin',
    'production_manager',
    'inventory_manager',
    'logistics',
    'finance'
  )
);

revoke all on function private.apply_stock_movement() from public;
