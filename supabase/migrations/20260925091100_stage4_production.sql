alter table public.products
  add column if not exists is_sellable boolean not null default true;

create type public.production_qc_status as enum ('pending', 'passed', 'failed');

insert into public.products (
  id,
  sku,
  name,
  category,
  unit_of_measure,
  price,
  active,
  is_sellable,
  low_stock_threshold
)
values
  ('30000000-0000-4000-8000-000000000006', 'QSA-RAW-MAIZE', 'Maize Meal', 'Raw Material', 'kg', 0, true, false, 1000),
  ('30000000-0000-4000-8000-000000000007', 'QSA-RAW-SOY', 'Soybean Meal', 'Raw Material', 'kg', 0, true, false, 700),
  ('30000000-0000-4000-8000-000000000008', 'QSA-RAW-PREMIX', 'Vitamin Mineral Premix', 'Raw Material', 'kg', 0, true, false, 150)
on conflict (id) do update
set category = excluded.category,
    unit_of_measure = excluded.unit_of_measure,
    is_sellable = excluded.is_sellable,
    low_stock_threshold = excluded.low_stock_threshold;

create table public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  unit text not null check (char_length(trim(unit)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.raw_materials (id, product_id, name, unit)
values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000006', 'Maize Meal', 'kg'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000007', 'Soybean Meal', 'kg'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000008', 'Vitamin Mineral Premix', 'kg')
on conflict (product_id) do update
set name = excluded.name,
    unit = excluded.unit;

insert into public.stock_levels (product_id, current_quantity, unit)
values
  ('30000000-0000-4000-8000-000000000006', 6000, 'kg'),
  ('30000000-0000-4000-8000-000000000007', 4200, 'kg'),
  ('30000000-0000-4000-8000-000000000008', 900, 'kg')
on conflict (product_id) do update
set current_quantity = excluded.current_quantity,
    unit = excluded.unit;

create table public.production_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default private.business_date(),
  shift text not null check (shift in ('morning', 'evening', 'night')),
  product_id uuid not null references public.products (id) on delete restrict,
   quantity_produced numeric(14, 2) not null check (quantity_produced > 0 and quantity_produced <> 'NaN'::numeric),
   qc_status public.production_qc_status not null default 'pending',
   qc_notes text,
   constraint production_run_failed_qc_note check (qc_status <> 'failed' or char_length(trim(coalesce(qc_notes, ''))) > 0),
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.production_run_materials (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.production_runs (id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials (id) on delete restrict,
   quantity_consumed numeric(14, 2) not null check (quantity_consumed > 0 and quantity_consumed <> 'NaN'::numeric),
  unit text not null check (char_length(trim(unit)) > 0),
  created_at timestamptz not null default now(),
  constraint production_run_material_unique unique (run_id, raw_material_id)
);

create index production_runs_date_idx on public.production_runs (run_date desc);
create index production_run_materials_run_idx on public.production_run_materials (run_id);

create or replace function private.record_production_output()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.qc_status <> 'passed' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.qc_status = 'passed' then
    return new;
  end if;

  if exists (
    select 1
    from public.stock_movements
    where source = 'production'
      and reference_id = new.id
      and reason = 'Production output'
  ) then
    return new;
  end if;

  insert into public.stock_movements (
    product_id,
    quantity,
    movement_type,
    source,
    reference_id,
    reason,
    created_by
  )
  values (
    new.product_id,
    new.quantity_produced,
    'in',
    'production',
    new.id,
    'Production output',
    new.created_by
  );

  return new;
end;
$$;

create or replace function private.validate_production_qc_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.run_date <> old.run_date
    or new.shift <> old.shift
    or new.product_id <> old.product_id
    or new.quantity_produced <> old.quantity_produced
    or new.created_by <> old.created_by
  then
    raise exception 'Only QC fields can be updated after production is recorded';
  end if;

  if new.qc_status <> old.qc_status and old.qc_status <> 'pending' then
    raise exception 'QC status cannot change after it is finalized';
  end if;

  if new.qc_status = 'failed' and char_length(trim(coalesce(new.qc_notes, ''))) = 0 then
    raise exception 'Failed QC requires notes';
  end if;

  return new;
end;
$$;

create or replace function private.record_material_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  material_product_id uuid;
begin
  select product_id
  into material_product_id
  from public.raw_materials
  where id = new.raw_material_id;

  if material_product_id is null then
    raise exception 'Raw material % does not exist', new.raw_material_id;
  end if;

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
    material_product_id,
    new.quantity_consumed,
    'out',
    'production',
    new.run_id,
    'Production material consumption',
    r.created_by
  from public.production_runs as r
  where r.id = new.run_id;

  return new;
end;
$$;

create trigger production_runs_validate_qc_update
before update on public.production_runs
for each row
execute function private.validate_production_qc_update();

create trigger production_runs_record_output
after insert or update of qc_status on public.production_runs
for each row
execute function private.record_production_output();

create trigger production_materials_record_consumption
after insert on public.production_run_materials
for each row
execute function private.record_material_consumption();

create trigger raw_materials_set_updated_at
before update on public.raw_materials
for each row
execute function public.set_updated_at();

create trigger production_runs_set_updated_at
before update on public.production_runs
for each row
execute function public.set_updated_at();

create or replace view public.production_yield
with (security_invoker = true)
as
with material_totals as (
  select
    m.run_id,
    sum(m.quantity_consumed) as raw_material_quantity
  from public.production_run_materials as m
  group by m.run_id
)
select
  r.id as run_id,
  r.run_date,
  r.shift,
  p.name as product_name,
  r.quantity_produced,
  coalesce(mt.raw_material_quantity, 0) as raw_material_quantity,
  case
    when coalesce(mt.raw_material_quantity, 0) > 0
      then round(r.quantity_produced / mt.raw_material_quantity, 4)
    else null
  end as yield_ratio
from public.production_runs as r
join public.products as p on p.id = r.product_id
left join material_totals as mt on mt.run_id = r.id
where r.qc_status = 'passed';

alter table public.raw_materials enable row level security;
alter table public.production_runs enable row level security;
alter table public.production_run_materials enable row level security;

revoke all on table public.raw_materials, public.production_runs, public.production_run_materials from anon, authenticated;
grant select on table public.raw_materials, public.production_runs, public.production_run_materials to authenticated;
grant update (qc_status, qc_notes) on table public.production_runs to authenticated;
grant insert, update on table public.raw_materials to authenticated;
grant select on public.production_yield to authenticated;

drop policy if exists raw_materials_select_scope on public.raw_materials;
create policy raw_materials_select_scope
on public.raw_materials
for select
to authenticated
using (private.current_user_role() in ('admin', 'production_manager', 'inventory_manager', 'finance'));

drop policy if exists raw_materials_write_internal on public.raw_materials;
create policy raw_materials_write_internal
on public.raw_materials
for all
to authenticated
using (private.current_user_role() in ('admin', 'production_manager', 'inventory_manager'))
with check (private.current_user_role() in ('admin', 'production_manager', 'inventory_manager'));

drop policy if exists production_runs_select_scope on public.production_runs;
create policy production_runs_select_scope
on public.production_runs
for select
to authenticated
using (private.current_user_role() in ('admin', 'production_manager', 'inventory_manager', 'finance'));

drop policy if exists production_materials_select_scope on public.production_run_materials;
create policy production_materials_select_scope
on public.production_run_materials
for select
to authenticated
using (private.current_user_role() in ('admin', 'production_manager', 'inventory_manager', 'finance'));

drop policy if exists production_runs_update_internal on public.production_runs;
create policy production_runs_update_internal
on public.production_runs
for update
to authenticated
using (
  private.current_user_role() in ('admin', 'production_manager')
  and (
    private.current_user_role() = 'admin'
    or created_by = (select auth.uid())
  )
)
with check (
  private.current_user_role() in ('admin', 'production_manager')
);

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
    where p.id = stock_levels.product_id
      and p.active
      and p.is_sellable
  )
);

revoke all on function private.record_production_output() from public;
revoke all on function private.validate_production_qc_update() from public;
revoke all on function private.record_material_consumption() from public;

drop policy if exists products_select_scope on public.products;
create policy products_select_scope
on public.products
for select
to authenticated
using (
  private.current_user_role() in ('admin', 'production_manager', 'inventory_manager', 'logistics', 'finance')
  or (active and is_sellable)
);
