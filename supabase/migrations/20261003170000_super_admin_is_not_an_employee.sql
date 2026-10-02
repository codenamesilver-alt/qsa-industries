-- The super admin is not an employee.
--
-- The portal has one account that exists to run the portal: admin@qsa.com. It is not
-- a person on the company chart, it has no job title, no reporting line and no
-- manager, and putting it on the chart states a fact about the business that is not
-- true. It was on the chart anyway, and it was on it because of a filter that was
-- written to keep dealers out and never mentioned admins:
--
--   private.org_people_rows()  where u.role <> 'dealer'
--   private.org_person(id)     where u.role <> 'dealer'
--   admin_clear_org_chart()    where role <> 'dealer'
--
-- Every read of the company chart and the staff roster derives from those, and the
-- views inherit them, so one missing exclusion put the super admin in the org
-- chart, in both staff pickers on the org builder, and in the reporting line
-- dropdowns.
--
-- Two things deliberately do not change:
--
--   private.is_internal_staff() keeps returning true for an admin. It is an
--   authorisation function, not a description of the org. Narrowing it would lock
--   the super admin out of the very data it needs to maintain the portal, and the
--   "can this person see this row" policies on users, org_positions and the
--   designations catalogue all depend on it.
--
--   public.users keeps the admin row. Authentication, RLS and admin_upsert_
--   user_profile all need it. The guarantee is about how the row is read, not
--   about whether it exists.
--
-- ---------------------------------------------------------------------------
-- 1. private.is_employee_role()
--
-- One predicate, so "who is on the company chart" is answered in one place rather
-- than re-derived by each function. Excludes both non-employees: an admin, who runs
-- the portal, and a dealer, who is a customer. Null is false, because a null role is
-- not a person anybody can point at on a chart.
-- ---------------------------------------------------------------------------

create or replace function private.is_employee_role(a_role public.user_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a_role is not null
    and a_role not in ('admin'::public.user_role, 'dealer'::public.user_role)
$$;

comment on function private.is_employee_role(public.user_role) is
  'True for a role that is a person who works for the company. Excludes admin, which is the portal super admin and not an employee, and dealer, which is a customer. Null is false. Use this rather than re-deriving "role <> ''dealer''", which is how the super admin came to sit on the org chart.';

-- ---------------------------------------------------------------------------
-- 2. The two org functions
--
-- org_people_rows is one row per box on the chart and org_person is the same read
-- by id; org_staff_roster is a cross join lateral over org_person and needs no
-- change, because it can no longer see the row it was inheriting.
-- ---------------------------------------------------------------------------

create or replace function private.org_people_rows()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role user_role,
  designation text,
  designation_id uuid,
  is_active boolean,
  reports_to_id uuid,
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    u.full_name,
    u.email,
    u.role,
    d.name,
    u.designation_id,
    u.is_active,
    u.reports_to_id,
    u.sort_order
  from public.users as u
  left join public.designations as d on d.id = u.designation_id
  where private.is_employee_role(u.role)
    and private.is_internal_staff()
$$;

comment on function private.org_people_rows() is
  'One row per employee, for the people chart. A portal super admin is not an employee and is excluded here even though is_internal_staff() is true for it: that function decides what an account may read, this one decides who is on the company chart.';

create or replace function private.org_person(target_user_id uuid)
returns table (
  full_name text,
  email text,
  role user_role,
  designation text,
  designation_id uuid,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name, u.email, u.role, d.name, u.designation_id, u.is_active
  from public.users as u
  left join public.designations as d on d.id = u.designation_id
  where u.id = target_user_id
    and private.is_employee_role(u.role)
    and private.is_internal_staff()
$$;

comment on function private.org_person(uuid) is
  'One employee by user id. Returns no row for a dealer or for the portal super admin, which is what stops the super admin appearing in the staff pickers on the org builder.';

-- ---------------------------------------------------------------------------
-- 3. admin_clear_org_chart
--
-- Same predicate. The super admin's reports_to_id is already null so this changes
-- no row today; it is here so the day somebody points a reporting line at the
-- super admin, clearing the chart does not quietly treat that line as company
-- structure.
-- ---------------------------------------------------------------------------

create or replace function public.admin_clear_org_chart()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared integer;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can clear the organisation chart';
  end if;

  -- "and reports_to_id is not null" is what makes the count mean something. Without
  -- it the update touches every employee, because setting a null column to null
  -- still counts as a change to that row in PL/pgSQL's diagnostics.
  update public.users
     set reports_to_id = null
   where private.is_employee_role(role)
     and reports_to_id is not null;

  get diagnostics v_cleared = row_count;

  return v_cleared;
end;
$$;

comment on function public.admin_clear_org_chart() is
  'Clear the reporting line: every employee becomes a head of the company. Admin only. Returns the number of reporting lines actually removed, not the number of rows visited. Dealer logins and the portal super admin are not employees and are left alone. There is no partial mode; 20261003110000 had one and it could not do anything.';

revoke all on function public.admin_clear_org_chart() from public;
revoke all on function public.admin_clear_org_chart() from anon;
grant execute on function public.admin_clear_org_chart() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_set_reports_to refuses the super admin as well as a dealer
--
-- 20261003140000 fixed this writer for dealers and left admins in, on the same
-- wrong assumption. The check only proves the id is a real account; it says nothing
-- about whether that account is somebody who works for the company. Naming the super
-- admin as a manager produces exactly the broken box that fix describes: the line is
-- invisible, because the manager's own row is filtered out of the chart.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_reports_to(
  p_user_id uuid,
  p_reports_to_id uuid
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.users%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the reporting line';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'No user with that id';
  end if;

  -- Nobody reports to themselves. A dealer login cannot be moved either, so
  -- this runs before the self check rather than after it: the two answers to
  -- "who is this person" are the same question. Dealer and super admin get
  -- separate refusals, because an operator who typed one of those ids wants to
  -- know which of the two they hit, and a single generic message would not tell
  -- them.
  if exists (select 1 from public.users where id = p_user_id and role = 'dealer') then
    raise exception 'A dealer login is not part of the company chart';
  end if;

  if exists (select 1 from public.users where id = p_user_id and role = 'admin') then
    raise exception 'The portal super admin is not an employee and is not part of the company chart';
  end if;

  if p_user_id = p_reports_to_id then
    raise exception 'Somebody cannot report to themselves';
  end if;

  if p_reports_to_id is not null then
    if not exists (select 1 from public.users where id = p_reports_to_id) then
      raise exception 'No user with that id to report to';
    end if;

    if exists (select 1 from public.users where id = p_reports_to_id and role = 'dealer') then
      raise exception 'A dealer login is not part of the company chart';
    end if;

    if exists (select 1 from public.users where id = p_reports_to_id and role = 'admin') then
      raise exception 'The portal super admin is not an employee and cannot be a manager';
    end if;

    -- Walk up from the proposed manager. If the person being moved is anywhere on
    -- that path, closing the edge would make a loop, and the chart would stop being
    -- a tree. The guard inside the walk stops the query being expensive on a
    -- pathological graph, which the constraint on users_no_self_reporting already
    -- prevents for the one-hop case but not for the rest.
    if exists (
      with recursive up as (
        select p_reports_to_id as id, 1 as depth
        union all
        select u.reports_to_id, up.depth + 1
          from public.users as u
          join up on u.id = up.id
         where u.reports_to_id is not null
           and up.depth < 64
      )
      select 1 from up where id = p_user_id
    ) then
      raise exception
        'That would create a loop: they already sit above this person in the chart';
    end if;
  end if;

  update public.users
     set reports_to_id = p_reports_to_id
   where id = p_user_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_set_reports_to(uuid, uuid) is
  'Move one person under another on the org chart, or promote them to a head of the company by passing null. Admin only. Refuses a non-employee on either end, which is a dealer login or the portal super admin, refuses self-reporting, and refuses any move that would close a reporting loop, because a chart with a loop in it is not a chart. Deliberately independent of users.manager_id, which is the three-level sales reporting line and enforces a different rule set that a CEO or a quality chemist cannot satisfy.';

revoke all on function public.admin_set_reports_to(uuid, uuid) from public;
revoke all on function public.admin_set_reports_to(uuid, uuid) from anon;
grant execute on function public.admin_set_reports_to(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
