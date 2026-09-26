create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum (
  'admin',
  'production_manager',
  'inventory_manager',
  'sales_rep',
  'sales_manager',
  'sales_director',
  'logistics',
  'finance',
  'dealer'
);

create type public.dealer_status as enum ('active', 'inactive', 'suspended');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) > 0),
  email text not null unique,
  role public.user_role not null default 'sales_rep',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_hierarchy (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id) on delete cascade,
  manager_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_hierarchy_no_self_management check (user_id <> manager_id)
);

create table public.dealers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  contact_person text,
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  credit_limit numeric(14, 2) not null default 0 check (credit_limit >= 0 and credit_limit <> 'NaN'::numeric),
  credit_limit_override numeric(14, 2) check (credit_limit_override >= 0 and credit_limit_override <> 'NaN'::numeric),
  sales_rep_id uuid references public.users (id) on delete set null,
  status public.dealer_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (char_length(trim(sku)) > 0),
  name text not null check (char_length(trim(name)) > 0),
  category text not null check (char_length(trim(category)) > 0),
  unit_of_measure text not null check (char_length(trim(unit_of_measure)) > 0),
  price numeric(14, 2) not null check (price >= 0 and price <> 'NaN'::numeric),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  dealer_id uuid references public.dealers (id) on delete cascade,
  price_tier text check (char_length(trim(price_tier)) > 0),
  price numeric(14, 2) not null check (price >= 0 and price <> 'NaN'::numeric),
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_scope check (num_nonnulls(dealer_id, price_tier) = 1),
  constraint price_lists_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index user_hierarchy_manager_id_idx on public.user_hierarchy (manager_id);
create index dealers_sales_rep_id_idx on public.dealers (sales_rep_id);
create index price_lists_product_id_idx on public.price_lists (product_id);
create index price_lists_dealer_id_idx on public.price_lists (dealer_id);
create index price_lists_dealer_product_idx
  on public.price_lists (product_id, dealer_id)
  where dealer_id is not null;
create index price_lists_tier_product_idx
  on public.price_lists (product_id, price_tier)
  where dealer_id is null;
alter table public.price_lists
  add constraint price_lists_dealer_period_excl
  exclude using gist (
    product_id with =,
    dealer_id with =,
    daterange(
      coalesce(valid_from, '-infinity'::date),
      coalesce(valid_to, 'infinity'::date),
      '[]'
    ) with &&
  ) where (dealer_id is not null);
alter table public.price_lists
  add constraint price_lists_tier_period_excl
  exclude using gist (
    product_id with =,
    price_tier with =,
    daterange(
      coalesce(valid_from, '-infinity'::date),
      coalesce(valid_to, 'infinity'::date),
      '[]'
    ) with &&
  ) where (dealer_id is null);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

create trigger user_hierarchy_set_updated_at
before update on public.user_hierarchy
for each row
execute function public.set_updated_at();

create trigger dealers_set_updated_at
before update on public.dealers
for each row
execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

create trigger price_lists_set_updated_at
before update on public.price_lists
for each row
execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.user_hierarchy enable row level security;
alter table public.dealers enable row level security;
alter table public.products enable row level security;
alter table public.price_lists enable row level security;
