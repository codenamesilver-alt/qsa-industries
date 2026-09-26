alter table public.users
  add column if not exists dealer_id uuid references public.dealers (id) on delete set null;

create unique index if not exists users_dealer_id_unique_idx
  on public.users (dealer_id)
  where dealer_id is not null;

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
  from public.users as u
  where u.id = (select auth.uid())
    and u.is_active
$$;

create or replace function private.current_dealer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.dealer_id
  from public.users as u
  where u.id = (select auth.uid())
    and u.is_active
$$;

create or replace function private.business_date()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (timezone('Asia/Kolkata', now()))::date
$$;

create or replace function private.is_ancestor_or_self(ancestor_id uuid, descendant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select h.user_id, h.manager_id
    from public.user_hierarchy as h
    where h.user_id = descendant_id

    union

    select h.user_id, h.manager_id
    from public.user_hierarchy as h
    join chain as parent on h.user_id = parent.manager_id
  )
  select exists (
    select 1
    from chain
    where user_id = ancestor_id
  )
$$;

create or replace function private.can_view_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select u.id, u.role, u.is_active
    from public.users as u
    where u.id = (select auth.uid())
  ), target as (
    select u.id, u.role
    from public.users as u
    where u.id = target_user_id
  )
  select coalesce(
    (
      select case
        when actor.is_active is not true or target.id is null then false
        when actor.role = 'admin' then true
        when actor.role = 'sales_director'
          and target.role in ('sales_director', 'sales_manager', 'sales_rep') then true
        when actor.role = 'sales_manager'
          and (
            target.id = actor.id
            or (
              target.role = 'sales_rep'
              and private.is_ancestor_or_self(actor.id, target.id)
            )
          ) then true
        when actor.role = 'sales_rep'
          and (
            target.id = actor.id
            or (
              target.role in ('sales_manager', 'sales_director')
              and private.is_ancestor_or_self(target.id, actor.id)
            )
          ) then true
        else target.id = actor.id
      end
      from actor
      cross join target
    ),
    false
  )
$$;

create or replace function private.can_view_dealer(target_dealer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select u.id, u.role, u.dealer_id, u.is_active
    from public.users as u
    where u.id = (select auth.uid())
  ), dealer as (
    select d.id, d.sales_rep_id
    from public.dealers as d
    where d.id = target_dealer_id
  )
  select coalesce(
    (
      select case
        when actor.is_active is not true or dealer.id is null then false
        when actor.role in ('admin', 'sales_director', 'finance') then true
        when actor.role = 'sales_manager'
          and private.is_ancestor_or_self(actor.id, dealer.sales_rep_id) then true
        when actor.role = 'sales_rep' and dealer.sales_rep_id = actor.id then true
        when actor.role = 'dealer' and dealer.id = actor.dealer_id then true
        else false
      end
      from actor
      cross join dealer
    ),
    false
  )
$$;

create or replace function private.can_edit_dealer(target_dealer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select u.id, u.role, u.dealer_id, u.is_active
    from public.users as u
    where u.id = (select auth.uid())
  )
  select coalesce(
    (
      select actor.is_active is true
        and (
          actor.role = 'admin'
          or (actor.role = 'dealer' and actor.dealer_id = target_dealer_id)
        )
      from actor
    ),
    false
  )
$$;

create or replace function private.can_view_price_list(target_dealer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select u.role, u.dealer_id, u.is_active
    from public.users as u
    where u.id = (select auth.uid())
  )
  select coalesce(
    (
      select case
        when actor.is_active is not true then false
        when actor.role in (
          'admin',
          'sales_director',
          'sales_manager',
          'sales_rep',
          'finance'
        ) then true
        when actor.role = 'dealer'
          and (target_dealer_id is null or target_dealer_id = actor.dealer_id) then true
        else false
      end
      from actor
    ),
    false
  )
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text;
begin
  requested_role := new.raw_app_meta_data ->> 'role';

  insert into public.users (id, full_name, email, role, is_active)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New user'
    ),
    coalesce(new.email, 'unknown-' || new.id::text),
    case
      when requested_role in (
        'admin',
        'production_manager',
        'inventory_manager',
        'sales_rep',
        'sales_manager',
        'sales_director',
        'logistics',
        'finance',
        'dealer'
      ) then requested_role::public.user_role
      else 'sales_rep'::public.user_role
    end,
    true
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function private.handle_new_user();

revoke all on function private.current_user_role() from public;
revoke all on function private.current_dealer_id() from public;
revoke all on function private.business_date() from public;
revoke all on function private.is_ancestor_or_self(uuid, uuid) from public;
revoke all on function private.can_view_user(uuid) from public;
revoke all on function private.can_view_dealer(uuid) from public;
revoke all on function private.can_edit_dealer(uuid) from public;
revoke all on function private.can_view_price_list(uuid) from public;
revoke all on function private.handle_new_user() from public;

grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_dealer_id() to authenticated;
grant execute on function private.business_date() to authenticated;
grant execute on function private.is_ancestor_or_self(uuid, uuid) to authenticated;
grant execute on function private.can_view_user(uuid) to authenticated;
grant execute on function private.can_view_dealer(uuid) to authenticated;
grant execute on function private.can_edit_dealer(uuid) to authenticated;
grant execute on function private.can_view_price_list(uuid) to authenticated;

revoke all on table public.users, public.user_hierarchy, public.dealers, public.products, public.price_lists
from anon, authenticated;

grant select on table public.users, public.user_hierarchy, public.dealers, public.products, public.price_lists
to authenticated;

grant update (full_name, phone) on table public.users to authenticated;
grant update (
  name,
  contact_person,
  phone,
  email,
  address_line1,
  address_line2,
  city,
  state,
  postal_code,
  country
) on table public.dealers to authenticated;

drop policy if exists users_select_scope on public.users;
create policy users_select_scope
on public.users
for select
to authenticated
using (private.can_view_user(id));

drop policy if exists users_update_self on public.users;
create policy users_update_self
on public.users
for update
to authenticated
using (id = (select auth.uid()) and is_active)
with check (id = (select auth.uid()) and is_active);

drop policy if exists user_hierarchy_select_scope on public.user_hierarchy;
create policy user_hierarchy_select_scope
on public.user_hierarchy
for select
to authenticated
using (private.can_view_user(user_id));

drop policy if exists dealers_select_scope on public.dealers;
create policy dealers_select_scope
on public.dealers
for select
to authenticated
using (private.can_view_dealer(id));

drop policy if exists dealers_update_scope on public.dealers;
create policy dealers_update_scope
on public.dealers
for update
to authenticated
using (private.can_edit_dealer(id))
with check (private.can_edit_dealer(id));

drop policy if exists products_select_scope on public.products;
create policy products_select_scope
on public.products
for select
to authenticated
using (
  private.current_user_role() is not null
  and (private.current_user_role() = 'admin' or active)
);

drop policy if exists price_lists_select_scope on public.price_lists;
create policy price_lists_select_scope
on public.price_lists
for select
to authenticated
using (
  private.can_view_price_list(dealer_id)
  and (valid_from is null or valid_from <= private.business_date())
  and (valid_to is null or valid_to >= private.business_date())
);
