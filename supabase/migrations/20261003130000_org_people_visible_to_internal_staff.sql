-- The people chart, visible to internal staff rather than to admins only.
--
-- 20261003110000 built public.org_people and public.org_people_tree as
-- security_invoker views straight over public.users, and its own comment says why
-- that was acceptable: "the audience is admin, who can_view_user admits
-- unconditionally." That reasoning was about the admin editor and it was wrong for
-- the chart, because the chart is not an admin screen. It is the one page every
-- internal role is admitted to read, and the users policy admits an internal reader
-- to exactly one row -- their own. So a quality chemist opening the organization
-- chart saw one box containing themselves and an otherwise empty page, while the
-- page copy said anybody on the portal can read it.
--
-- This is the same problem the post chart solved in 20260928110000 with
-- private.org_person, and it is solved the same way: the rows come from a
-- security definer function that filters on the caller rather than on the row, and
-- the view is a join over that. The function is the control. The view cannot be,
-- because a view has no way to ask who is reading.
--
-- Two things are deliberately not here.
--
--   * Dealer logins stay out. A dealer is a customer with a login, not an employee,
--     and putting one on the company chart would both be wrong and leak the shape of
--     the business to the outside.
--
--   * No per-user override, no "only my department". A company chart is one chart.
--     An internal employee reading who they report to is the feature; carving the
--     chart up by role would make it a thing nobody could trust.

-- ---------------------------------------------------------------------------
-- 1. The rows, read past the users policy
-- ---------------------------------------------------------------------------

create or replace function private.org_people_rows()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.user_role,
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
  where u.role <> 'dealer'
    and private.is_internal_staff()
$$;

comment on function private.org_people_rows() is
  'Every employee with their designation and their reporting line, read past the users RLS that hides every other row from internal staff. One call, not one per box: the chart needs the whole company to draw a tree, and the post chart could afford a call per post because it had a post row to hang the call on. Empty for a dealer login and empty for an unauthenticated caller. Reads the users table directly rather than going through private.org_person, because a chart of forty people would otherwise make forty passes over the same table with the same predicate.';

grant execute on function private.org_people_rows() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The views, rebuilt over the function
--
-- Dropped before created, because the SELECT list below changes shape and there is
-- no CREATE OR REPLACE that can widen a view.
-- ---------------------------------------------------------------------------

drop view if exists public.org_people_tree;
drop view if exists public.org_people;

create view public.org_people
with (security_invoker = true)
as
select
  p.user_id,
  p.full_name,
  p.email,
  p.role,
  p.designation_id,
  p.designation,
  p.is_active,
  p.reports_to_id,
  p.sort_order
from private.org_people_rows() as p;

comment on view public.org_people is
  'Every employee, with the designation they hold and the person they report to. This is what the org chart reads. security_invoker over private.org_people_rows, so a dealer login or a signed-out caller gets no rows rather than the whole company.';

-- reports_to_name and reports_to_designation are joined rather than looked up by the
-- client because the detail panel wants to say "reports to Priya, Director" without
-- a second round trip, and a self-join over one function call is cheaper than
-- forty queries. The join is on reports_to_id and nothing else: a person whose
-- reports_to_id points at a dealer login, or at an account removed by some route
-- other than the cascade, keeps their box with the name null rather than being
-- dropped off the company's own chart.
create view public.org_people_tree
with (security_invoker = true)
as
select
  p.user_id,
  p.full_name,
  p.email,
  p.role,
  p.designation_id,
  p.designation,
  p.is_active,
  p.reports_to_id,
  mgr.full_name as reports_to_name,
  mgr.designation_id as reports_to_designation_id,
  mgr.designation as reports_to_designation,
  p.sort_order
from private.org_people_rows() as p
left join private.org_people_rows() as mgr on mgr.user_id = p.reports_to_id;

comment on view public.org_people_tree is
  'The org chart in the shape the screen draws it: one row per employee, carrying their own designation and the name and designation of whoever they report to. A person nobody reports to is a head of the company, and any number of those is allowed.';

revoke all on table public.org_people from public, anon, authenticated;
grant select on table public.org_people to authenticated;
revoke all on table public.org_people_tree from public, anon, authenticated;
grant select on table public.org_people_tree to authenticated;

notify pgrst, 'reload schema';