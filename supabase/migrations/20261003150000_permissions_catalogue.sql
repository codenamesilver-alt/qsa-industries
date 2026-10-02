-- A permission catalogue, so "what may this job title do" is data rather than a
-- copy of a role list buried in a policy.
--
-- What this is NOT, stated up front because the distinction is the whole design:
--
--   public.user_role stays, and stays load-bearing. Nothing in this migration
--   changes who can see which row of which order today. That is a second,
--   different question with a second, different answer:
--
--     "May a quality chemist open the purchasing screen at all?"
--       -> a permission. This migration.
--
--     "May a quality chemist open THAT purchase order?"
--       -> private.can_view_dealer(), private.can_view_user(), the sales
--          hierarchy. Not a permission, and deliberately not modelled as one.
--
--   So every policy that reads private.can_view_dealer() is untouched, correctly.
--   Turning a row-scoping rule into a yes/no permission would be a real loss of
--   safety, and the way to find that out is to ship it and be wrong in public.
--
-- What this migration also does NOT do: no policy calls private.can_access() yet.
-- The matrix below is seeded to reproduce today's behaviour exactly, so the table
-- is the source of truth being built rather than something already in force. The
-- remaining wiring is listed at the bottom of this file. Read this as a ledger that
-- is currently true by construction, not as enforcement.
--
-- Resolution order for private.can_access(code):
--
--   admin          -> always true. Every existing policy bypasses admin by hand,
--                      so baking it in keeps that honest in one place instead of
--                      39 times.
--   inactive user  -> false. An account switched off must lose its permissions,
--                      not keep them until it is deleted.
--   dealer role    -> designation grants do not apply. A dealer is a customer,
--                      not an employee, and the dealer portal is scoped to their
--                      own dealer row. Letting a designation lift a dealer into
--                      finance would be a privilege escalation dressed as a
--                      convenience. Dealer policies are separate code and read
--                      can_view_dealer(), not this table, so nothing here reaches
--                      them yet.
--   otherwise      -> role grant OR designation grant. A union, never a
--                      subtraction: a designation can widen what its holder may do
--                      and cannot take away what their role already allows. Denial
--                      stays a matter of which role a person has.
--
-- Two layers, because the organisation needs both answers to different questions:
--
--   role_permissions        "a finance officer may view invoices". The base tier.
--                          Seeded from the role lists already in the policies.
--   designation_permissions "the Chief Financial Officer may view all dealers".
--                          Empty, and filled in from the admin screen. Additive
--                          only, which is the one behaviour worth being explicit
--                          about: there is no per-user or per-designation deny.
--
-- ---------------------------------------------------------------------------

create table if not exists public.permissions (
  code text primary key,
  name text not null,
  description text not null default '',
  group_name text not null,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  constraint permissions_code_is_slug check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint permissions_code_is_lowercase check (code = lower(code))
);

comment on table public.permissions is
  'The operations this application has. One row per thing somebody can be allowed to do, as distinct from the rows they are allowed to see. role_permissions and designation_permissions both point at code; nothing else is needed to grant one.';

create table if not exists public.role_permissions (
  -- No foreign key on role: user_role is an enum type, and REFERENCES needs a
  -- relation. The column type is the constraint -- Postgres refuses a value that
  -- is not one of the ten -- which is what the key would have been for.
  role public.user_role not null,
  permission_code text not null references public.permissions (code) on delete cascade,
  primary key (role, permission_code)
);

comment on table public.role_permissions is
  'The base permission tier, keyed on public.user_role. Seeded in 20261003150000 to reproduce the role lists already written into the policies, so switching a policy over to private.can_access() cannot change who gets in. Editable only through the admin RPCs: this is the floor, and lowering it affects everybody holding that role.';

create table if not exists public.designation_permissions (
  designation_id uuid not null references public.designations (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null,
  primary key (designation_id, permission_code)
);

comment on table public.designation_permissions is
  'What a job title adds on top of the role, as a union rather than an override. Editing this table is the ordinary case: a new Chief Financial Officer designation, or a Quality Head who needs the purchasing screen. An empty table means designations change nothing, which is exactly the state of the application before this migration.';

-- ---------------------------------------------------------------------------
-- The catalogue
--
-- Grouped the way the sidebar is grouped, because the screen that edits this is
-- read by an admin deciding which box to tick and the group is the thing they
-- navigate by. sort_order is manual rather than alphabetical for the same reason:
-- "view" belongs above "record" in every group, and alphabetical puts approve
-- before view.
--
-- The codes are named for the action, not the table. A permission called
-- "purchase_orders" would have to be re-read every time it was used, and would
-- not say whether it meant seeing one or writing one.
-- ---------------------------------------------------------------------------

insert into public.permissions (code, name, description, group_name, sort_order) values
  -- Company
  ('company.view_org_chart',        'View the organisation chart',   'See who reports to whom and every employee''s job title.',                                        'Company',    10),
  ('company.manage_org_chart',      'Edit the organisation chart',   'Move somebody under somebody else, promote somebody to a head, clear the reporting lines.',   'Company',    20),
  ('company.manage_designations',   'Manage the job title catalogue','Add, rename and retire the job titles that people can hold.',                                   'Company',    30),

  -- Sales
  ('sales.view_orders',             'View sales orders',             'Open the order list and the orders inside it, within their own reporting scope.',              'Sales',      10),
  ('sales.approve_orders',          'Approve sales orders',          'Approve or reject a submitted order.',                                                          'Sales',      20),
  ('sales.manage_dealers',          'Manage dealers',                'Create a dealer, edit their details and commercial terms, deactivate them.',                    'Sales',      30),
  ('sales.manage_credit',           'Manage dealer credit',          'Change a credit limit or hold period and resolve a credit block.',                                'Sales',      40),
  ('sales.view_reports',            'View sales reports',            'Regional and date-range sales reporting.',                                                      'Sales',      50),

  -- Inventory
  ('inventory.view_stock',          'View stock',                    'Stock levels, movements and the ledger behind them.',                                           'Inventory',  10),
  ('inventory.write_stock',         'Receive and adjust stock',      'Write stock movements against a product.',                                                      'Inventory',  20),
  ('inventory.adjust_threshold',    'Change the stock alert level',  'Move the reorder point for a product.',                                                         'Inventory',  30),

  -- Production
  ('production.view_runs',          'View production runs',          'Read production runs, batches and their materials.',                                            'Production', 10),
  ('production.manage_runs',        'Create and run production',     'Start, progress and close a production run.',                                                  'Production', 20),
  ('production.write_materials',    'Manage raw materials',          'Add and edit raw material records.',                                                            'Production', 30),
  ('production.record_qc',          'Record quality checks',         'Pass, fail or hold a batch against its specification.',                                         'Production', 40),

  -- Purchasing
  ('purchasing.view_orders',        'View purchase orders',          'Read purchase orders raised against raw materials.',                                            'Purchasing', 10),
  ('purchasing.manage_orders',      'Raise and change purchase orders','Create a purchase order and move it through its statuses.',                                    'Purchasing', 20),

  -- Delivery
  ('delivery.view_board',           'View the delivery board',       'Read deliveries and their status.',                                                             'Delivery',   10),
  ('delivery.update_status',        'Update delivery status',        'Move a delivery through dispatch, transit and delivery.',                                        'Delivery',   20),

  -- Finance
  ('finance.view_invoices',         'View invoices',                 'Read invoices, their lines and GST breakdown.',                                                'Finance',    10),
  ('finance.record_payments',       'Record and allocate payments',  'Take a payment and split it across invoices.',                                                  'Finance',    20),
  ('finance.view_settings',         'View finance settings',         'Read invoice numbering, terms and credit ageing settings.',                                     'Finance',    30),
  ('finance.export_tally',          'Export to Tally',               'Produce the Tally export files.',                                                               'Finance',    40);

comment on column public.permissions.group_name is
  'Display grouping only. Not a permission itself: a group is not granted, and no policy tests it. Two permissions sharing a group have nothing to do with each other.';

-- ---------------------------------------------------------------------------
-- The base tier, read off the policies rather than invented
--
-- Every list below quotes a policy that already exists, named in the comment, so
-- a reader can check the claim without running anything. Where a policy was
-- written with 'admin' inside the list, admin is dropped here because
-- private.can_access() short-circuits on it; keeping it would be a second place
-- that knows about the bypass.
-- ---------------------------------------------------------------------------

insert into public.role_permissions (role, permission_code)
select g.role_name::public.user_role, x.permission_code
from (values
  -- An administrator does everything. Left to the bypass in private.can_access()
  -- rather than listed 27 times.
  ('admin', array[]::text[]),

  -- stock_levels / stock_movements select scope, 20260925091000: admin,
  -- production_manager, inventory_manager, logistics, finance
  ('production_manager', array[
    'inventory.view_stock', 'inventory.adjust_threshold',
    'production.view_runs', 'production.manage_runs', 'production.write_materials', 'production.record_qc',
    'purchasing.view_orders',
    'company.view_org_chart'
  ]),
  ('inventory_manager', array[
    'inventory.view_stock', 'inventory.write_stock', 'inventory.adjust_threshold',
    'production.view_runs', 'production.write_materials',
    'purchasing.view_orders', 'purchasing.manage_orders',
    'company.view_org_chart'
  ]),
  ('logistics', array[
    'inventory.view_stock',
    'production.view_runs',
    'delivery.view_board', 'delivery.update_status',
    'company.view_org_chart'
  ]),
  ('finance', array[
    'inventory.view_stock',
    'sales.view_reports',
    'purchasing.view_orders',
    'delivery.view_board',
    'finance.view_invoices', 'finance.record_payments', 'finance.view_settings', 'finance.export_tally',
    'company.view_org_chart'
  ]),
  ('qc_staff', array[
    'production.view_runs', 'production.record_qc',
    'company.view_org_chart'
  ]),
  ('sales_director', array[
    'sales.view_orders', 'sales.approve_orders', 'sales.manage_dealers', 'sales.manage_credit', 'sales.view_reports',
    'delivery.view_board',
    'company.view_org_chart'
  ]),
  ('sales_manager', array[
    'sales.view_orders', 'sales.manage_dealers', 'sales.view_reports',
    'delivery.view_board',
    'company.view_org_chart'
  ]),
  ('sales_rep', array[
    'sales.view_orders',
    'company.view_org_chart'
  ]),
  -- A dealer is a customer. These rows exist so the catalogue is complete and the
  -- matrix on the admin screen has no blank row, but they grant nothing yet: the
  -- dealer portal is scoped by private.can_view_dealer() and private.can_edit_dealer(),
  -- which answer a row question rather than a feature question. See the header.
  ('dealer', array[
    'sales.view_orders'
  ])
) as g (role_name, codes)
cross join lateral unnest(g.codes) as x (permission_code);

-- ---------------------------------------------------------------------------
-- Reads
--
-- Three tables, all readable by any signed-in account. The permission matrix is
-- not a secret: knowing that "QC Head" can view production runs is not leverage,
-- and an admin cannot configure a matrix they cannot see. Writes go through
-- security definer RPCs instead, so that changing a permission and changing an
-- account's role stay auditable in the same way -- one call, one actor, checked
-- against the role rather than trusted to the caller.
-- ---------------------------------------------------------------------------

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.designation_permissions enable row level security;

create policy permissions_read_authenticated
  on public.permissions for select to authenticated
  using (true);

create policy role_permissions_read_authenticated
  on public.role_permissions for select to authenticated
  using (true);

create policy designation_permissions_read_authenticated
  on public.designation_permissions for select to authenticated
  using (true);

-- Reads for the admin screen, one row per permission with everything the screen
-- needs to draw a checkbox, so the page does not join three tables in the browser
-- and does not have to know the shape of the matrix.
create or replace view public.permission_matrix
with (security_invoker = true)
as
  select
    p.code,
    p.name,
    p.description,
    p.group_name,
    p.sort_order,
    coalesce(
      (
        select jsonb_object_agg(g.role_name, g.role_has_it)
        from (
          select r.role::text as role_name,
                 exists (
                   select 1 from public.role_permissions as rp
                   where rp.role = r.role and rp.permission_code = p.code
                 ) as role_has_it
          from unnest(enum_range(null::public.user_role)) as r (role)
        ) as g
      ),
      '{}'::jsonb
    ) as by_role,
    coalesce(
      (
        select jsonb_object_agg(d.id::text, d.designation_has_it)
        from (
          select ds.id, exists (
            select 1 from public.designation_permissions as dp
            where dp.designation_id = ds.id and dp.permission_code = p.code
          ) as designation_has_it
          from public.designations as ds
          where ds.is_active
        ) as d
      ),
      '{}'::jsonb
    ) as by_designation
  from public.permissions as p
  where p.is_active
;

grant select on public.permission_matrix to authenticated;

-- ---------------------------------------------------------------------------
-- Resolution
--
-- private.has_role_permission and private.has_designation_permission exist as
-- separate functions rather than inline branches in can_access because two things
-- need them independently: can_access needs the union, and the admin screen needs
-- to show the base tier greyed out and un-clickable.
-- ---------------------------------------------------------------------------

create or replace function private.has_role_permission(
  p_role public.user_role,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_permissions as rp
    where rp.role = p_role
      and rp.permission_code = p_permission_code
  )
$$;

comment on function private.has_role_permission(public.user_role, text) is
  'The base tier on its own, with no admin bypass and no designation layer, so an admin screen can ask what the role provides without asking what the person can do.';

create or replace function private.has_designation_permission(
  p_designation_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.designation_permissions as dp
    where dp.designation_id = p_designation_id
      and dp.permission_code = p_permission_code
  )
$$;

comment on function private.has_designation_permission(uuid, text) is
  'What a job title adds, on its own. Ignores the holder''s role, so it cannot be mistaken for the answer to "may this person do it".';

create or replace function private.can_access(p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      with actor as (
        select u.id, u.role, u.designation_id, u.is_active
        from public.users as u
        where u.id = (select auth.uid())
      )
      select
        case
          -- Ordered, not independent: the admin bypass has to come before the
          -- dealer exclusion, or an admin whose role were ever changed to dealer
          -- would keep the bypass.
          when actor.is_active is not true then false
          when actor.role = 'admin' then true
          when actor.role = 'dealer' then false
          when private.has_role_permission(actor.role, p_permission_code) then true
          when private.has_designation_permission(actor.designation_id, p_permission_code) then true
          else false
        end
      from actor
    ),
    -- Signed out, or no public.users row yet. A permission granted to nobody is
    -- the safe reading: an anonymous caller has no role and no title to look up.
    false
  )
$$;

comment on function private.can_access(text) is
  'May the signed-in account do this kind of thing at all. True for admin regardless of the tables, false for an inactive account and for a dealer, otherwise the union of the role tier and the designation tier. Says nothing about which rows are in scope -- that is private.can_view_dealer() and friends, and a permission will never answer it.';

grant execute on function private.can_access(text) to authenticated;
grant execute on function private.has_role_permission(public.user_role, text) to authenticated;
grant execute on function private.has_designation_permission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Writes
--
-- Four RPCs rather than one set-payload, for the reason that matters under a
-- policy: each one is a single statement a caller can be stopped from making, so
-- there is no way to pass an array and have part of it applied. A caller who
-- cannot see the catalogue has nothing valid to send, because the codes are
-- checked against public.permissions rather than trusted.
--
-- None of these notify pgrst. Nothing about the schema changes, and the screen
-- revalidates itself after the call returns.
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_designation_permission(
  p_designation_id uuid,
  p_permission_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change what a job title may do';
  end if;

  -- A designation that has been retired keeps its rows here rather than losing
  -- them, because retiring a title and granting one are separate decisions and
  -- undoing the second should not silently undo the first. The grant is refused
  -- instead, so the mistake is visible at the point it is made.
  if not exists (
    select 1 from public.designations
    where id = p_designation_id and is_active
  ) then
    raise exception 'No active job title with that id';
  end if;

  if not exists (
    select 1 from public.permissions
    where code = p_permission_code and is_active
  ) then
    raise exception 'No active permission with that code';
  end if;

  insert into public.designation_permissions (designation_id, permission_code, granted_by)
  values (p_designation_id, p_permission_code, auth.uid())
  on conflict do nothing;

  return true;
end;
$$;

create or replace function public.admin_revoke_designation_permission(
  p_designation_id uuid,
  p_permission_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change what a job title may do';
  end if;

  delete from public.designation_permissions
  where designation_id = p_designation_id
    and permission_code = p_permission_code;

  -- Not an error. Revoking what is not granted is what the admin meant, and a
  -- double click on an un-tick button should not read as a failure.
  return true;
end;
$$;

create or replace function public.admin_grant_role_permission(
  p_role public.user_role,
  p_permission_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change what a role may do';
  end if;

  -- This is the dangerous one of the four. Lowering the base tier changes access
  -- for every holder of the role, including people who were never on the screen
  -- when it changed, so it is refused rather than offered.
  raise exception 'The base role tier is fixed. Grant the permission to a job title instead';
end;
$$;

create or replace function public.admin_revoke_role_permission(
  p_role public.user_role,
  p_permission_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change what a role may do';
  end if;

  raise exception 'The base role tier is fixed. It is read off the policies, not configured';
end;
$$;

comment on function public.admin_grant_designation_permission(uuid, text) is
  'Let one job title do one thing on top of whatever its holder''s role already allows. Admin only. Refuses a retired title and an unknown permission code, so a typo is an error rather than a silent no-op.';
comment on function public.admin_revoke_designation_permission(uuid, text) is
  'Remove one grant. Admin only. Succeeds when there was nothing to remove.';
comment on function public.admin_grant_role_permission(public.user_role, text) is
  'Always raises. Present so the refusal is discoverable rather than a 404 on a function that does not exist, and so the reason travels with the call.';
comment on function public.admin_revoke_role_permission(public.user_role, text) is
  'Always raises, for the same reason as admin_grant_role_permission.';

revoke all on function public.admin_grant_designation_permission(uuid, text) from public;
revoke all on function public.admin_revoke_designation_permission(uuid, text) from public;
revoke all on function public.admin_grant_role_permission(public.user_role, text) from public;
revoke all on function public.admin_revoke_role_permission(public.user_role, text) from public;

grant execute on function public.admin_grant_designation_permission(uuid, text) to authenticated;
grant execute on function public.admin_revoke_designation_permission(uuid, text) to authenticated;
grant execute on function public.admin_grant_role_permission(public.user_role, text) to authenticated;
grant execute on function public.admin_revoke_role_permission(public.user_role, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What this migration deliberately leaves undone
--
--  1. No policy calls private.can_access() yet. Wiring one is a separate
--     migration per policy, each with its own test, because a policy is the only
--     place where this can actually lock somebody out.
--
--  2. public.org_positions and the four post-chart RPCs are still there. Empty,
--     tested, unreferenced by any page. 20261003110000 added the people chart
--     alongside rather than over the top of it, and the removals are still owed.
--
--  3. Account creation still takes a p_role, and it is still the deciding factor
--     in every live policy. Until (1) is done, "designation" and "what this
--     account may do" remain two different things, and the admin screen says so.
--
--  4. There is no per-user override and no deny row. Granting is additive.
-- ---------------------------------------------------------------------------