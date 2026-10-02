-- Fix rep and manager names in the reporting views, which every non-commercial-
-- hierarchy role saw as "Unassigned rep".
--
-- 20260928100000 and 20260928101000 resolve display names by joining public.users
-- from inside security_invoker views:
--
--   left join public.users as rep on rep.id = o.sales_rep_id
--   coalesce(nullif(rep.full_name, ''), 'Unassigned rep') as rep_name
--
-- public.users carries row level security, and its policy is
--
--   users_select_scope using (private.can_view_user(id))
--
-- can_view_user has branches for admin, sales_director and sales_manager, and no
-- branch for finance. So for a finance session every row of public.users is
-- filtered out, both left joins return null, and the coalesce substitutes the
-- literal. The finance portal /sales/reports drew five rows all labelled
-- "Unassigned rep", three all labelled "Unassigned manager", and React logged a
-- duplicate key.
--
-- The figures underneath were never wrong. dealer_count, realized_amount and
-- pipeline_amount group by o.sales_rep_id, which is a uuid read from orders, so
-- finance saw the correct money under the wrong names. That is worse than an
-- error page: a report that ranks five indistinguishable rows and totals them
-- correctly reads as a data problem in the figures rather than in the labels.
--
-- private.region_of, from the same migration, is the precedent for the fix. A
-- reporting view legitimately needs a value that the reporting user's own RLS
-- would hide, and the answer there is a security_definer helper rather than a
-- widened policy. Widening users_select_scope instead would have been wrong: it
-- would have exposed every user's row, not the handful of names a sales report
-- needs, and it would have done so to every table reading public.users.
--
-- The helper is narrowed on purpose. It returns a name only for a user who is
-- actually part of the sales reporting hierarchy. A rep's name next to their
-- realized revenue is what a sales report is; a QC technician's name, an
-- inventory manager's, or a dealer's login-linked staff name is not, and none of
-- them are reachable through this function.
--
-- It also returns nothing for an inactive user. A disabled rep still holds
-- historical orders, and attributing last year's revenue to a name that no
-- longer belongs to a live account is how a report becomes wrong about a person.
-- The orders keep their sales_rep_id, so the row is still there, just without a
-- name, which is the honest state for a rep who has left.
--
-- The views are replaced rather than re-granted, so no client contract changes:
-- column names and types are identical.

-- ---------------------------------------------------------------------------
-- private.sales_display_name(target_user_id uuid)
--
-- Name of a user who is part of the sales reporting hierarchy, or null.
-- ---------------------------------------------------------------------------
create or replace function private.sales_display_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name
  from public.users as u
  where u.id = target_user_id
    and u.is_active
    and u.role in ('sales_rep', 'sales_manager', 'sales_director')
$$;

comment on function private.sales_display_name(uuid) is
  'Display name for a user in the sales reporting hierarchy, read past the users RLS that hides the whole table from finance. Null for any other role, for an inactive account, and for a missing id, so a sales report can name a rep without becoming a staff directory. Deliberately narrower than can_view_user: this grants names, not rows.';

revoke all on function private.sales_display_name(uuid) from public;
grant execute on function private.sales_display_name(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- private.sales_manager_name(target_rep_id uuid)
--
-- Name of the rep's manager, or null.
--
-- Needed as a second helper because the manager edge is not visible to finance
-- either. public.user_hierarchy carries the same policy as public.users,
--
--   user_hierarchy_select_scope using (private.can_view_user(user_id))
--
-- so for a finance session the manager join returns no row and manager_id is null
-- before the name is even considered. Passing a name into sales_display_name was
-- not enough: the edge has to be resolved past the RLS as well. The id comes from
-- the helper too, so manager_id is populated for finance and the two never
-- disagree about who reports to whom.
--
-- Resolved through user_hierarchy, which is the authoritative edge, rather than
-- by searching users for a role, because a user can sit under a manager and also
-- hold the sales_manager role themselves.
-- ---------------------------------------------------------------------------
create or replace function private.sales_manager_name(target_rep_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.sales_display_name(h.manager_id)
  from public.user_hierarchy as h
  where h.user_id = target_rep_id
$$;

comment on function private.sales_manager_name(uuid) is
  'Display name of a rep''s manager, read past the users and user_hierarchy RLS that hide both from finance. Null for a rep with no hierarchy row and for a manager outside the sales hierarchy. The hierarchy edge is resolved here because the edge itself, not just the name, is invisible to those roles.';

revoke all on function private.sales_manager_name(uuid) from public;
grant execute on function private.sales_manager_name(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- private.sales_manager_id(target_rep_id uuid)
--
-- The same edge, returned as an id rather than a name, so manager_id is populated
-- for callers who cannot see user_hierarchy. Split from sales_manager_name
-- because a report that shows "Unassigned manager" next to a real manager_id is
-- self-contradictory, and because callers link on the id, not the label.
-- ---------------------------------------------------------------------------
create or replace function private.sales_manager_id(target_rep_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.manager_id
  from public.user_hierarchy as h
  where h.user_id = target_rep_id
$$;

comment on function private.sales_manager_id(uuid) is
  'Manager id of a rep, read past the user_hierarchy RLS. Null for a rep with no manager. Returned separately from sales_manager_name so a report can carry a real manager_id alongside a name that resolved to the Unassigned placeholder for a genuine reason, such as an inactive manager.';

revoke all on function private.sales_manager_id(uuid) from public;
grant execute on function private.sales_manager_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_by_rep
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_rep
with (security_invoker = true)
as
select
  o.sales_rep_id as rep_id,
  coalesce(private.sales_display_name(o.sales_rep_id), 'Unassigned rep') as rep_name,
  private.sales_manager_id(o.sales_rep_id) as manager_id,
  coalesce(private.sales_manager_name(o.sales_rep_id), 'Unassigned manager') as manager_name,
  private.region_of(o.dealer_id) as region,
  count(distinct o.dealer_id) as dealer_count,
  count(*) filter (
    where o.status in ('approved', 'dispatched', 'invoiced')
  ) as realized_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ),
    0
  ) as realized_amount,
  count(*) filter (
    where o.status in ('pending', 'pending_director_approval')
  ) as pipeline_orders,
  coalesce(
    sum(o.total_amount) filter (
      where o.status in ('pending', 'pending_director_approval')
    ),
    0
  ) as pipeline_amount
from public.orders as o
where private.can_view_dealer(o.dealer_id)
group by
  o.sales_rep_id,
  coalesce(private.sales_display_name(o.sales_rep_id), 'Unassigned rep'),
  private.sales_manager_id(o.sales_rep_id),
  coalesce(private.sales_manager_name(o.sales_rep_id), 'Unassigned manager'),
  private.region_of(o.dealer_id);

comment on view public.sales_by_rep is
  'One row per rep per region, with realized and pipeline kept apart. Names come from private.sales_display_name, so finance and any other role outside the users RLS see rep and manager names rather than the Unassigned placeholder.';

grant select on public.sales_by_rep to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_by_dealer -- same name resolution, for the drill-down.
-- ---------------------------------------------------------------------------
create or replace view public.sales_by_dealer
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  private.region_of(d.id) as region,
  d.state,
  d.status,
  d.credit_limit,
  coalesce(o.realized_orders, 0) as realized_orders,
  coalesce(o.realized_amount, 0) as realized_amount,
  coalesce(o.pipeline_orders, 0) as pipeline_orders,
  coalesce(o.pipeline_amount, 0) as pipeline_amount,
  coalesce(o.invoiced_amount, 0) as invoiced_amount,
  coalesce(inv.open_invoices, 0) as open_invoices,
  coalesce(inv.outstanding_amount, 0) as outstanding_amount
from public.dealers as d
left join (
  select
    o.dealer_id,
    count(*) filter (
      where o.status in ('approved', 'dispatched', 'invoiced')
    ) as realized_orders,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ),
      0
    ) as realized_amount,
    count(*) filter (
      where o.status in ('pending', 'pending_director_approval')
    ) as pipeline_orders,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('pending', 'pending_director_approval')
      ),
      0
    ) as pipeline_amount,
    coalesce(
      sum(o.total_amount) filter (where o.status = 'invoiced'),
      0
    ) as invoiced_amount
  from public.orders as o
  where private.can_view_dealer(o.dealer_id)
  group by o.dealer_id
) as o on o.dealer_id = d.id
left join lateral (
  select
    count(*) filter (where l.outstanding_amount > 0) as open_invoices,
    coalesce(sum(l.outstanding_amount), 0) as outstanding_amount
  from public.dealer_ledger as l
  where l.dealer_id = d.id
) as inv on true
where private.can_view_dealer(d.id);

comment on view public.sales_by_dealer is
  'One row per dealer visible to the caller, including dealers with no orders at zero, so a region dealer_count reconciles against this view instead of a second number.';

grant select on public.sales_by_dealer to authenticated;

-- ---------------------------------------------------------------------------
-- public.dealer_rep_coverage -- the /sales/team screen.
--
-- Same repair. This one is read by a sales manager, who is inside can_view_user,
-- so names were already correct there; it is replaced only so that a director,
-- a finance user or a future role reading the team screen does not inherit the
-- placeholder. Keeping one definition of the label is the point.
-- ---------------------------------------------------------------------------
create or replace view public.dealer_rep_coverage
with (security_invoker = true)
as
select
  u.id as rep_id,
  coalesce(private.sales_display_name(u.id), 'Unassigned rep') as rep_name,
  u.is_active,
  coalesce(private.sales_manager_name(u.id), 'Unassigned manager') as manager_name,
  coalesce(d.dealer_count, 0) as dealer_count,
  coalesce(d.realized_amount, 0) as realized_amount,
  coalesce(d.pipeline_amount, 0) as pipeline_amount,
  coalesce(ua.unassigned_dealers, 0) as unassigned_dealers
from public.users as u
left join lateral (
  select
    count(distinct dl.id) as dealer_count,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('approved', 'dispatched', 'invoiced')
      ),
      0
    ) as realized_amount,
    coalesce(
      sum(o.total_amount) filter (
        where o.status in ('pending', 'pending_director_approval')
      ),
      0
    ) as pipeline_amount
  from public.dealers as dl
  left join public.orders as o on o.dealer_id = dl.id
  where dl.sales_rep_id = u.id
) as d on true
left join lateral (
  select count(*) as unassigned_dealers
  from public.dealers as free
  where free.sales_rep_id is null
    and free.status = 'active'
    and private.can_manage_rep(u.id)
) as ua on true
where u.role = 'sales_rep';

comment on view public.dealer_rep_coverage is
  'One row per sales rep, including reps holding nothing. dealer_count counts distinct dealers, not joined order rows, so a rep with one busy dealer is not reported as holding dozens of accounts. Names come from private.sales_display_name, so the label does not depend on the caller being inside the users RLS.';

grant select on public.dealer_rep_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_rep_dealers -- the assignable dealer list.
--
-- Same repair for rep_name. This one is read by a manager before a write, so a
-- wrong label here is a manager reassigning a dealer believing it sits with a
-- different rep than the one the form submits.
-- ---------------------------------------------------------------------------
create or replace view public.sales_rep_dealers
with (security_invoker = true)
as
select
  d.id as dealer_id,
  d.name as dealer_name,
  d.status,
  private.region_of(d.id) as region,
  d.sales_rep_id,
  coalesce(private.sales_display_name(d.sales_rep_id), 'Unassigned') as rep_name,
  d.credit_limit,
  d.credit_limit_override
from public.dealers as d
where private.can_view_dealer(d.id);

comment on view public.sales_rep_dealers is
  'The dealer list for the assignment form, one row per dealer, scoped by can_view_dealer. rep_name is read through private.sales_display_name so the label a manager reads is the same label for every role that opens the form.';

grant select on public.sales_rep_dealers to authenticated;
