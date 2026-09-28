-- Admin master data: the four master tables an administrator owns, writable from
-- the browser through functions that check the role themselves.
--
-- PRD 4.3 and the "Admin" row of PRD 3.2 make an administrator the owner of
-- product catalogue, dealer master, price lists, users, roles and the
-- rep -> manager -> director hierarchy. None of that existed in the app. Product
-- thresholds and finance settings were editable; the catalogue, the dealer
-- record, the price lists, the user list and the hierarchy had no write path at
-- all, and role changes were only possible by running a script on a machine with
-- database credentials.
--
-- Shape follows the rest of the schema rather than introducing a new one: writes
-- go through SECURITY DEFINER functions that check private.current_user_role()
-- and return the row they wrote, exactly as create_dealer_order and
-- update_finance_settings do. Nothing here grants a column on a master table to
-- authenticated, because 20260926100600 established that a grant cannot
-- distinguish admin from dealer, and a table grant on products would have let any
-- signed-in user reprice the catalogue.
--
-- Account *creation* is deliberately still out of band. Creating an auth user
-- needs the service role key, which must never reach a browser or this
-- application, so new logins are still created by web/scripts/provision-user.mjs
-- or the seed migrations. What this migration adds is the ability to change a
-- role, suspend an account, and set the reporting line of an account that
-- already exists, which is the part that was genuinely missing and the part that
-- needs a control.
--
-- Every refusal below is a raise, not a silent no-op, and none of them is
-- expressed as a row level security policy: the policies scope rows, these
-- functions decide who may act.

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_product(
  p_sku text,
  p_name text,
  p_category text,
  p_unit_of_measure text,
  p_price numeric,
  p_hsn_code text,
  p_product_id uuid default null,
  p_low_stock_threshold numeric default 0,
  p_is_sellable boolean default true,
  p_active boolean default true
)
returns public.products
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  saved_row public.products%rowtype;
  v_sku text := nullif(trim(p_sku), '');
  v_name text := nullif(trim(p_name), '');
  v_category text := nullif(trim(p_category), '');
  v_unit text := nullif(trim(p_unit_of_measure), '');
  v_hsn text := nullif(trim(p_hsn_code), '');
begin
  actor_role := private.current_user_role();

  if actor_role is distinct from 'admin' then
    raise exception 'Only an admin can change the product catalogue';
  end if;

  if v_sku is null or v_name is null or v_category is null or v_unit is null then
    raise exception 'SKU, name, category and unit of measure are all required';
  end if;

  if v_hsn is null then
    raise exception 'A product needs an HSN code of 4, 6 or 8 digits';
  end if;

  -- The NaN tests below read backwards on purpose and are worth a second look.
  -- In PostgreSQL NaN is equal to itself and greater than every other numeric
  -- value, so '41.5' <> 'NaN' is true and '41.5' = 'NaN' is false: the way to ask
  -- "is this NaN" is <> inside a CHECK constraint, where the whole expression
  -- must be true to be accepted, and = inside an IF, where you are raising on
  -- the bad case. Writing <> here would have refused every valid price.
  if p_price is null or p_price < 0 or p_price = 'NaN'::numeric then
    raise exception 'Price must be zero or more';
  end if;

  if p_low_stock_threshold is null
    or p_low_stock_threshold < 0
    or p_low_stock_threshold = 'NaN'::numeric then
    raise exception 'Low stock threshold must be zero or more';
  end if;

  if p_product_id is null then
    insert into public.products (
      sku,
      name,
      category,
      unit_of_measure,
      price,
      hsn_code,
      low_stock_threshold,
      is_sellable,
      active
    )
    values (
      v_sku,
      v_name,
      v_category,
      v_unit,
      p_price,
      v_hsn,
      p_low_stock_threshold,
      coalesce(p_is_sellable, true),
      coalesce(p_active, true)
    )
    returning * into saved_row;

    return saved_row;
  end if;

  update public.products
     set sku = v_sku,
         name = v_name,
         category = v_category,
         unit_of_measure = v_unit,
         price = p_price,
         hsn_code = v_hsn,
         low_stock_threshold = p_low_stock_threshold,
         is_sellable = coalesce(p_is_sellable, is_sellable),
         active = coalesce(p_active, active)
   where id = p_product_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No product with that id';
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_upsert_product(text, text, text, text, numeric, text, uuid, numeric, boolean, boolean) is
  'Create or edit a catalogue product. Admin only. Price edits are safe against history: order_items and invoice_lines snapshot the price they were raised at, so changing the catalogue never rewrites an issued document. Products are retired with active or is_sellable rather than deleted, because stock_movements, order_items and invoice_lines all reference a product row.';

-- ---------------------------------------------------------------------------
-- Dealers
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_dealer(
  p_name text,
  p_credit_limit numeric,
  p_dealer_id uuid default null,
  p_contact_person text default null,
  p_phone text default null,
  p_email text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_credit_limit_override numeric default null,
  p_clear_credit_override boolean default false,
  p_status public.dealer_status default 'active',
  p_region text default null,
  p_sales_rep_id uuid default null
)
returns public.dealers
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealers%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_region text := nullif(trim(p_region), '');
  v_email text := nullif(trim(p_email), '');
  v_credit numeric;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change dealer master data';
  end if;

  if v_name is null then
    raise exception 'A dealer needs a name';
  end if;

  -- The region report asserts that no dealer falls through to Unassigned, which
  -- is only a true statement if a new dealer cannot be created without one.
  if v_region is null then
    raise exception 'A dealer needs a sales region';
  end if;

  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Dealer email does not look like an email address';
  end if;

  if p_credit_limit is null
    or p_credit_limit < 0
    or p_credit_limit = 'NaN'::numeric then
    raise exception 'Credit limit must be zero or more';
  end if;

  if p_credit_limit_override is not null
    and (p_credit_limit_override < 0 or p_credit_limit_override = 'NaN'::numeric) then
    raise exception 'Credit limit override must be zero or more';
  end if;

  -- A dealer mapped to a user who is not an active sales rep cannot be ordered
  -- for: create_dealer_order reads the mapping, and orders.sales_rep_id is not
  -- null. Refusing here means the mistake is made at the point of the edit.
  if p_sales_rep_id is not null and not exists (
    select 1
    from public.users as u
    where u.id = p_sales_rep_id
      and u.role = 'sales_rep'
      and u.is_active
  ) then
    raise exception 'A dealer must be mapped to an active sales rep';
  end if;

  v_credit := case
    when p_clear_credit_override then null
    else p_credit_limit_override
  end;

  if p_dealer_id is null then
    insert into public.dealers (
      name,
      contact_person,
      phone,
      email,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      credit_limit,
      credit_limit_override,
      status,
      region,
      sales_rep_id
    )
    values (
      v_name,
      nullif(trim(p_contact_person), ''),
      nullif(trim(p_phone), ''),
      v_email,
      nullif(trim(p_address_line1), ''),
      nullif(trim(p_address_line2), ''),
      nullif(trim(p_city), ''),
      nullif(trim(p_state), ''),
      nullif(trim(p_postal_code), ''),
      p_credit_limit,
      v_credit,
      coalesce(p_status, 'active'::public.dealer_status),
      v_region,
      p_sales_rep_id
    )
    returning * into saved_row;

    return saved_row;
  end if;

  update public.dealers
     set name = v_name,
         contact_person = nullif(trim(p_contact_person), ''),
         phone = nullif(trim(p_phone), ''),
         email = v_email,
         address_line1 = nullif(trim(p_address_line1), ''),
         address_line2 = nullif(trim(p_address_line2), ''),
         city = nullif(trim(p_city), ''),
         state = nullif(trim(p_state), ''),
         postal_code = nullif(trim(p_postal_code), ''),
         credit_limit = p_credit_limit,
         credit_limit_override = v_credit,
         status = coalesce(p_status, status),
         region = v_region,
         sales_rep_id = p_sales_rep_id
   where id = p_dealer_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No dealer with that id';
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_upsert_dealer(text, numeric, uuid, text, text, text, text, text, text, text, text, numeric, boolean, public.dealer_status, text, uuid) is
  'Create or edit a dealer. Admin only; the commercial columns are additionally policed by private.guard_dealer_commercial_columns, so a browser write of credit_limit, status, region or sales_rep_id is refused twice over. Dealers are never deleted: orders reference them on delete restrict, and status inactive or suspended is the retirement path.';

-- ---------------------------------------------------------------------------
-- Price lists
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_price_list(
  p_product_id uuid,
  p_price numeric,
  p_price_list_id uuid default null,
  p_dealer_id uuid default null,
  p_price_tier text default null,
  p_valid_from date default null,
  p_valid_to date default null
)
returns public.price_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.price_lists%rowtype;
  v_tier text := nullif(trim(p_price_tier), '');
  v_from date;
  v_to date;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change price lists';
  end if;

  -- price_lists_scope requires exactly one of the two, and the reason it is one
  -- rather than two is that a row with both set is ambiguous about who it prices.
  if (p_dealer_id is null) = (v_tier is null) then
    raise exception 'A price must belong to either one dealer or one tier, not both and not neither';
  end if;

  if not exists (
    select 1 from public.products as p where p.id = p_product_id
  ) then
    raise exception 'No product with that id';
  end if;

  if p_dealer_id is not null and not exists (
    select 1 from public.dealers as d where d.id = p_dealer_id
  ) then
    raise exception 'No dealer with that id';
  end if;

  if p_price is null or p_price < 0 or p_price = 'NaN'::numeric then
    raise exception 'Price must be zero or more';
  end if;

  v_from := p_valid_from;
  v_to := p_valid_to;

  if v_from is not null and v_to is not null and v_to < v_from then
    raise exception 'A price cannot end before it starts';
  end if;

  -- The exclusion constraints on this table already forbid two overlapping
  -- periods for the same product and scope. Checking first only changes the
  -- message: 23P01 is correct but reads like a database fault on a screen.
  if exists (
    select 1
    from public.price_lists as existing
    where existing.product_id = p_product_id
      and existing.id is distinct from p_price_list_id
      and existing.dealer_id is not distinct from p_dealer_id
      and existing.price_tier is not distinct from v_tier
      and daterange(
            coalesce(existing.valid_from, '-infinity'::date),
            coalesce(existing.valid_to, 'infinity'::date),
            '[]'
          ) && daterange(coalesce(v_from, '-infinity'::date), coalesce(v_to, 'infinity'::date), '[]')
  ) then
    raise exception 'That product already has a price for this dealer or tier over those dates';
  end if;

  if p_price_list_id is null then
    insert into public.price_lists (
      product_id,
      dealer_id,
      price_tier,
      price,
      valid_from,
      valid_to
    )
    values (p_product_id, p_dealer_id, v_tier, p_price, v_from, v_to)
    returning * into saved_row;

    return saved_row;
  end if;

  update public.price_lists
     set product_id = p_product_id,
         dealer_id = p_dealer_id,
         price_tier = v_tier,
         price = p_price,
         valid_from = v_from,
         valid_to = v_to
   where id = p_price_list_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'No price list entry with that id';
  end if;

  return saved_row;
end;
$$;

create or replace function public.admin_delete_price_list(p_price_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change price lists';
  end if;

  delete from public.price_lists where id = p_price_list_id;

  if not found then
    raise exception 'No price list entry with that id';
  end if;
end;
$$;

comment on function public.admin_upsert_price_list(uuid, numeric, uuid, uuid, text, date, date) is
  'Create or edit one dealer or tier price. Admin only. A dealer price is scoped to a single dealer and a tier price to every dealer not covered by a dealer price, which is the resolution order dealer_catalog implements.';

comment on function public.admin_delete_price_list(uuid) is
  'Remove one price list entry. Admin only. Deleting is safe: prices are read when an order line is raised and snapshotted onto the line.';

-- ---------------------------------------------------------------------------
-- Users, roles and the reporting hierarchy
-- ---------------------------------------------------------------------------

create or replace function public.admin_upsert_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_role public.user_role,
  p_is_active boolean,
  p_dealer_id uuid default null,
  p_manager_id uuid default null
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_row public.users%rowtype;
  saved_row public.users%rowtype;
  v_name text := nullif(trim(p_full_name), '');
  active_admins integer;
  new_active boolean;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change a user, a role or the reporting hierarchy';
  end if;

  select * into target_row from public.users where id = p_user_id;

  if target_row.id is null then
    raise exception 'No user with that id. Accounts are created out of band; this function changes an account that already exists.';
  end if;

  if v_name is null then
    raise exception 'A user needs a full name';
  end if;

  -- Lockout guards. An admin who edits their own role away from admin, or
  -- suspends themselves, leaves nobody able to undo it, because every function in
  -- this migration requires the admin role.
  if target_row.id = actor_id
    and (p_role is distinct from 'admin' or coalesce(p_is_active, target_row.is_active) is not true) then
    raise exception
      'An admin cannot change their own role or suspend themselves. Ask another admin to do it.';
  end if;

  if target_row.role = 'admin'
    and target_row.is_active
    and (p_role <> 'admin' or coalesce(p_is_active, target_row.is_active) is not true) then
    select count(*) into active_admins
    from public.users as u
    where u.role = 'admin' and u.is_active;

    if active_admins <= 1 then
      raise exception 'The last active admin cannot be demoted or suspended';
    end if;
  end if;

  -- The other side of the same lockout, and the one that bites first. Every other
  -- check here looks outward from the account being edited: does the manager it is
  -- being pointed at exist, is it active, is it the right role. Nothing looked
  -- inward, at the accounts already pointing at this one, so an admin could
  -- demote a manager or suspend one while two reps still reported to them and the
  -- call would succeed. Nothing downstream complains either: the tree is still
  -- three levels, user_hierarchy still resolves, and can_view_dealer still walks
  -- it -- it just stops matching, so those two reps silently lose sight of their
  -- own dealers and the only evidence is an empty page. Move the reports first.
  new_active := coalesce(p_is_active, target_row.is_active);

  if exists (
    select 1
    from public.user_hierarchy as h
    join public.users as child on child.id = h.user_id
    where h.manager_id = p_user_id
      and child.is_active
      and (
        (child.role = 'sales_rep' and (p_role <> 'sales_manager' or new_active is not true))
        or (child.role = 'sales_manager' and (p_role <> 'sales_director' or new_active is not true))
      )
  ) then
    raise exception
      'Active accounts still report to this one. Move them to another manager first.';
  end if;

  -- A dealer login is meaningless without the dealer it logs in as, and a staff
  -- login carrying a dealer_id would be able to read that dealer's data through
  -- the dealer policies.
  if p_role = 'dealer' and p_dealer_id is null then
    raise exception 'A dealer account must be linked to a dealer';
  end if;

  if p_role <> 'dealer' and p_dealer_id is not null then
    raise exception 'Only a dealer account can be linked to a dealer';
  end if;

  if p_dealer_id is not null and not exists (
    select 1 from public.dealers as d where d.id = p_dealer_id
  ) then
    raise exception 'No dealer with that id';
  end if;

  -- The hierarchy is three levels deep by design, so the parent of each role is
  -- fixed rather than free. A director with a manager, or a rep pointing at
  -- another rep, is not a shape the rest of the schema can read.
  if p_role = 'sales_rep' then
    if p_manager_id is null then
      raise exception 'A sales rep must report to a sales manager';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_manager' and m.is_active
    ) then
      raise exception 'A sales rep reports to an active sales manager';
    end if;
  elsif p_role = 'sales_manager' then
    if p_manager_id is null then
      raise exception 'A sales manager must report to the sales director';
    end if;

    if not exists (
      select 1 from public.users as m
      where m.id = p_manager_id and m.role = 'sales_director' and m.is_active
    ) then
      raise exception 'A sales manager reports to the active sales director';
    end if;
  elsif p_manager_id is not null then
    raise exception 'Only sales roles report to a manager';
  end if;

  update public.users
     set full_name = v_name,
         role = p_role,
         is_active = new_active,
         dealer_id = p_dealer_id
   where id = p_user_id
  returning * into saved_row;

  if p_manager_id is null then
    delete from public.user_hierarchy where user_id = p_user_id;
  else
    insert into public.user_hierarchy (user_id, manager_id)
    values (p_user_id, p_manager_id)
    on conflict (user_id)
    do update set manager_id = excluded.manager_id;
  end if;

  return saved_row;
end;
$$;

comment on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid) is
  'Change a user''s name, role, active flag, dealer link and reporting line in one call, so the profile and the hierarchy cannot disagree. Admin only. The account itself is created out of band: auth.users needs the service role key, which must not reach this application. Two lockout guards are deliberate: an admin may not edit their own role or suspend themselves, and the last active admin may not be demoted or suspended. A third refuses to demote or suspend an account that active accounts still report to, so the reporting line cannot be broken from the manager end.';

-- ---------------------------------------------------------------------------
-- The directory the admin screen reads
-- ---------------------------------------------------------------------------

drop view if exists public.user_directory;

create view public.user_directory
with (security_invoker = true)
as
select
  u.id as user_id,
  u.full_name,
  u.email,
  u.role,
  u.is_active,
  u.dealer_id,
  d.name as dealer_name,
  h.manager_id,
  m.full_name as manager_name,
  m.role as manager_role
from public.users as u
left join public.dealers as d on d.id = u.dealer_id
left join public.user_hierarchy as h on h.user_id = u.id
left join public.users as m on m.id = h.manager_id;

comment on view public.user_directory is
  'Every user with their dealer and their manager, for the admin screen. security_invoker so the existing users and user_hierarchy policies still decide who sees a row: an admin sees everyone, a manager sees their own reps.';

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- The view, and the same reasoning as the functions below applies to it with an
-- extra edge. A new object in the public schema inherits whatever the database's
-- default privileges say a new public object gets. On a hosted Supabase project
-- that includes the whole table of privileges for anon as well as authenticated,
-- so the staff directory would have been readable by an anonymous request; on a
-- database created by hand, which is what db:verify-fresh builds, the same view
-- inherits nothing and the admin screen cannot read its own data. Both were true
-- at once, on the same repository, which is the sort of difference that only shows
-- up when the two environments stop agreeing. Stated here, so they agree.
revoke all on public.user_directory from public, anon, authenticated;
grant select on public.user_directory to authenticated;

revoke all on function public.admin_upsert_product(text, text, text, text, numeric, text, uuid, numeric, boolean, boolean) from public;
revoke all on function public.admin_upsert_dealer(text, numeric, uuid, text, text, text, text, text, text, text, text, numeric, boolean, public.dealer_status, text, uuid) from public;
revoke all on function public.admin_upsert_price_list(uuid, numeric, uuid, uuid, text, date, date) from public;
revoke all on function public.admin_delete_price_list(uuid) from public;
revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid) from public;

-- anon is revoked by name as well, and that is not belt and braces: on a Supabase
-- project the default privileges for the public schema grant EXECUTE on every new
-- function to anon and authenticated, so revoking from public alone leaves anon
-- holding EXECUTE by direct grant. Nothing here is exploitable through it, since
-- every function refuses a null role, but a function that only an admin can run
-- should not appear in the anonymous role's privilege list at all.
revoke all on function public.admin_upsert_product(text, text, text, text, numeric, text, uuid, numeric, boolean, boolean) from anon;
revoke all on function public.admin_upsert_dealer(text, numeric, uuid, text, text, text, text, text, text, text, text, numeric, boolean, public.dealer_status, text, uuid) from anon;
revoke all on function public.admin_upsert_price_list(uuid, numeric, uuid, uuid, text, date, date) from anon;
revoke all on function public.admin_delete_price_list(uuid) from anon;
revoke all on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid) from anon;

grant execute on function public.admin_upsert_product(text, text, text, text, numeric, text, uuid, numeric, boolean, boolean) to authenticated;
grant execute on function public.admin_upsert_dealer(text, numeric, uuid, text, text, text, text, text, text, text, text, numeric, boolean, public.dealer_status, text, uuid) to authenticated;
grant execute on function public.admin_upsert_price_list(uuid, numeric, uuid, uuid, text, date, date) to authenticated;
grant execute on function public.admin_delete_price_list(uuid) to authenticated;
grant execute on function public.admin_upsert_user_profile(uuid, text, public.user_role, boolean, uuid, uuid) to authenticated;
