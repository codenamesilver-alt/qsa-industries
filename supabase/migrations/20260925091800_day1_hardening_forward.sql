create extension if not exists btree_gist with schema extensions;

alter table public.price_lists
  drop constraint if exists price_lists_dealer_period_excl;
alter table public.price_lists
  drop constraint if exists price_lists_tier_period_excl;
drop index if exists public.price_lists_dealer_product_unique_idx;
drop index if exists public.price_lists_tier_product_unique_idx;

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

alter table public.dealers
  drop constraint if exists dealers_credit_limit_check;

alter table public.dealers
  add constraint dealers_credit_limit_check
  check (credit_limit >= 0 and credit_limit <> 'NaN'::numeric);

alter table public.dealers
  drop constraint if exists dealers_credit_limit_override_check;

alter table public.dealers
  add constraint dealers_credit_limit_override_check
  check (credit_limit_override >= 0 and credit_limit_override <> 'NaN'::numeric);

alter table public.products
  drop constraint if exists products_price_check;

alter table public.products
  add constraint products_price_check
  check (price >= 0 and price <> 'NaN'::numeric);

alter table public.price_lists
  drop constraint if exists price_lists_price_check;

alter table public.price_lists
  add constraint price_lists_price_check
  check (price >= 0 and price <> 'NaN'::numeric);

create or replace function private.business_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (timezone('Asia/Kolkata', now()))::date
$$;

revoke all on function private.business_date() from public;
grant execute on function private.business_date() to authenticated;

alter table public.users
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.user_hierarchy
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.dealers
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.products
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table public.price_lists
  alter column created_at set default now(),
  alter column updated_at set default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
