-- Sales rep to dealer assignment, which PRD 3.1 implies and nothing implemented.
--
-- The schema already stores dealers.sales_rep_id, one column holding exactly one
-- rep. So a rep can hold many dealers, which is the thing being asked for here.
-- What does not exist is a manager-facing way to do the assigning:
--
--   * 20260926100700 made sales_rep_id admin only, with the reasoning that moving a
--     dealer between reps moves their credit exposure and account attribution. That
--     reasoning is sound and is kept: nobody below a manager can reassign.
--   * public.admin_upsert_dealer is the only writer of the column, and it is admin
--     only. So a sales manager, who owns a team and can approve their orders, has no
--     way to redistribute their own dealers. Every territory change is an admin task,
--     which is a bottleneck on the one decision a manager is best placed to make.
--
-- So this adds the missing workflow without loosening the existing rule. The rule
-- that stays: a manager may move a dealer only between reps inside their own team,
-- and only where that dealer is already theirs to move. A manager cannot take a
-- dealer from another manager, cannot hand a dealer to a rep they do not manage, and
-- cannot set the column to null.
--
-- Unassigned dealers are the deliberate exception. A dealer with a null
-- sales_rep_id is visible to nobody: can_view_dealer needs either the actor to be
-- the dealer or is_ancestor_or_self(actor, sales_rep_id), and both are false for
-- null. So an unassigned dealer is invisible to a manager and only an admin can
-- pick it up. A manager is given the unassigned list here, read-only, so they can
-- see that a dealer is unowned and ask for it, but claiming one stays an admin act.
-- That is the conservative reading of the same rule, and it avoids a second
-- definition of "unassigned" that disagrees with the RLS one.
--
-- Credit limits are deliberately out of scope. A manager redistributing accounts
-- within their own team cannot change any dealer's limit, because
-- guard_dealer_commercial_columns keeps credit_limit to admin and finance. Moving a
-- dealer does not move a limit, so this workflow cannot be used to concentrate
-- headroom on one rep.

-- ---------------------------------------------------------------------------
-- private.can_manage_rep(target_rep_id) -- "is this rep inside my team".
--
-- One level, not transitive. The hierarchy is rep -> manager -> director, so
-- resolving transitively would make every rep look manageable by the director as
-- well as by their own manager, and a director reassigning a dealer between two
-- managers' reps would pass a check written for one level. Matching
-- sales_by_rep, which also rolls up exactly one level for the same reason.
-- ---------------------------------------------------------------------------
create or replace function private.can_manage_rep(target_rep_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select u.id, u.role
    from public.users as u
    where u.id = (select auth.uid()) and u.is_active
  )
  select coalesce(
    (
      select actor.role = 'sales_manager'
        and exists (
          select 1
          from public.user_hierarchy as h
          join public.users as rep on rep.id = h.user_id
          where h.manager_id = actor.id
            and h.user_id = target_rep_id
            and rep.role = 'sales_rep'
            and rep.is_active
        )
      from actor
    ),
    false
  )
$$;

comment on function private.can_manage_rep(uuid) is
  'True when the calling user is a sales manager and the target user is one of their own active sales reps. One level only, matching the three level rep/manager/director tree, so a director does not pass this for a rep they do not directly manage.';

-- ---------------------------------------------------------------------------
-- public.dealer_rep_coverage -- who holds what, and who holds nothing.
--
-- A rep with no dealers is included with zeros, because "this rep covers nothing" is
-- the question a manager is actually asking when they open the screen. A dealer
-- list built from a join on dealers alone drops those reps, and a coverage report
-- that silently omits unassigned reps is worse than none: it looks complete.
--
-- Unassigned dealers appear as their own row rather than being attached to nobody,
-- for the same reason they are readable at all: an unowned dealer is a hole in the
-- book and the manager needs to see it. unassigned_dealers is a count, not a list,
-- because the RLS on dealers makes an unassigned dealer unreadable to a manager, so
-- any list built from the dealers table would be empty by construction.
-- ---------------------------------------------------------------------------
create or replace view public.dealer_rep_coverage
with (security_invoker = true)
as
select
  u.id as rep_id,
  u.full_name as rep_name,
  u.is_active,
  coalesce(mgr.full_name, 'Unassigned manager') as manager_name,
  coalesce(d.dealer_count, 0) as dealer_count,
  coalesce(d.realized_amount, 0) as realized_amount,
  coalesce(d.pipeline_amount, 0) as pipeline_amount,
  coalesce(ua.unassigned_dealers, 0) as unassigned_dealers
from public.users as u
left join public.user_hierarchy as h on h.user_id = u.id
left join public.users as mgr on mgr.id = h.manager_id
left join lateral (
  select
    count(*) as dealer_count,
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
-- Unassigned dealers are counted once per rep, which is a lie as a total but is the
-- only shape that answers the per-rep question without a second endpoint. It is
-- named as a count and never summed across rows: the caller shows it as a reminder,
-- not as a figure. A single scalar view would be honest and would not answer
-- "which of my reps is free to take one on".
left join lateral (
  select count(*) as unassigned_dealers
  from public.dealers as free
  where free.sales_rep_id is null
    and free.status = 'active'
    and private.can_manage_rep(u.id)
) as ua on true
where u.role = 'sales_rep';

grant select on public.dealer_rep_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_rep_dealers -- the assignable dealer list for one rep.
--
-- Separate from the coverage view because the coverage view is one row per rep and
-- this is one row per dealer. It is what the assignment form reads before the write,
-- so the manager sees the same rows they are about to change.
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
  coalesce(nullif(rep.full_name, ''), 'Unassigned') as rep_name,
  d.credit_limit,
  d.credit_limit_override
from public.dealers as d
left join public.users as rep on rep.id = d.sales_rep_id
where private.can_view_dealer(d.id);

grant select on public.sales_rep_dealers to authenticated;

-- ---------------------------------------------------------------------------
-- public.sales_assign_dealer_to_rep(p_dealer_id, p_sales_rep_id)
--
-- The one write path. Direct updates are not offered and would not work anyway:
-- dealers_update_scope allows admin and the dealer itself, and
-- dealers_update_internal allows admin and finance, so a manager has no UPDATE
-- policy on the table. Routing the change through a function means the scope rule
-- lives in one place next to the check it has to agree with.
--
-- Every refusal names the reason. "Only an admin can reassign a dealer to a
-- different sales rep" is what guard_dealer_commercial_columns says, and a manager
-- who hits it deserves to be told which of the four rules they broke.
-- ---------------------------------------------------------------------------
create or replace function public.sales_assign_dealer_to_rep(
  p_dealer_id uuid,
  p_sales_rep_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  actor_id uuid;
  current_rep_id uuid;
  dealer_status public.dealer_status;
begin
  select u.id, u.role into actor_id, actor_role
  from public.users as u
  where u.id = (select auth.uid()) and u.is_active;

  if actor_role is distinct from 'sales_manager' then
    raise exception 'Only a sales manager can reassign a dealer inside their own team';
  end if;

  if p_sales_rep_id is null then
    raise exception 'Pick a sales rep; only an admin can leave a dealer unassigned';
  end if;

  if not private.can_manage_rep(p_sales_rep_id) then
    raise exception 'You can only assign a dealer to one of your own active sales reps';
  end if;

  select d.sales_rep_id, d.status into current_rep_id, dealer_status
  from public.dealers as d
  where d.id = p_dealer_id;

  if current_rep_id is null and dealer_status is null then
    raise exception 'No dealer with that id';
  end if;

  -- The dealer must already belong to this manager's team. can_view_dealer is the
  -- same test the RLS uses, so the write and the read cannot disagree about who
  -- owns an account.
  if not private.can_view_dealer(p_dealer_id) then
    raise exception 'That dealer is not in your team; only an admin can move a dealer between managers';
  end if;

  if current_rep_id is null then
    raise exception 'That dealer has no sales rep; only an admin can claim an unassigned dealer';
  end if;

  if not private.can_manage_rep(current_rep_id) then
    raise exception 'That dealer currently sits with a rep outside your team';
  end if;

  if current_rep_id = p_sales_rep_id then
    return;
  end if;

  -- Writes through this function, so the guard on the table is updated first. The
  -- guard allows a manager for a rep_change, which is what makes this reachable at
  -- all, and it does not check which rep: that is the job of the four checks above,
  -- and duplicating the team test here would give two definitions of the same rule.
  update public.dealers
     set sales_rep_id = p_sales_rep_id
   where id = p_dealer_id;
end;
$$;

comment on function public.sales_assign_dealer_to_rep(uuid, uuid) is
  'Move a dealer between sales reps inside the calling manager''s own team. Refuses a dealer held by another team, an unassigned dealer, a null target, a non-rep target, and every role other than sales_manager.';

grant execute on function public.sales_assign_dealer_to_rep(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The guard, relaxed exactly one step.
--
-- 20260926100700 refused any sales_rep_id change below admin. That is still true for
-- finance, for a dealer editing their own row, and for every other role: the only
-- thing that changes is that a sales manager may now move a dealer between two reps,
-- provided the target is one of their own. The team test is not repeated here, so
-- the guard stays a single boolean and this migration does not have to track the
-- hierarchy rules in two files.
--
-- A manager cannot widen their own reach this way. can_view_dealer still has to
-- pass for the dealer, so the set of dealers a manager can reach is unchanged; what
-- changes is only which of their own reps holds one of them.
-- ---------------------------------------------------------------------------
create or replace function private.guard_dealer_commercial_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.user_role;
  actor_id uuid;
  commercial_change boolean;
  rep_change boolean;
  manager_move boolean;
begin
  commercial_change :=
       new.credit_limit          is distinct from old.credit_limit
    or new.credit_limit_override is distinct from old.credit_limit_override
    or new.status               is distinct from old.status
    or new.region               is distinct from old.region;
  rep_change := new.sales_rep_id is distinct from old.sales_rep_id;

  if not (commercial_change or rep_change) then
    return new;
  end if;

  select u.id, u.role into actor_id, actor_role
  from public.users as u
  where u.id = (select auth.uid()) and u.is_active;

  if actor_role is null then
    return new;
  end if;

  -- A manager moving a dealer to a rep on their own team. Checked here as well as in
  -- sales_assign_dealer_to_rep because the guard is what a direct table write goes
  -- through, and a rule that only exists inside the function is a rule the next
  -- grant can quietly bypass.
  if rep_change and actor_role = 'sales_manager' then
    manager_move :=
      new.sales_rep_id is not null
      and private.can_manage_rep(new.sales_rep_id)
      and private.can_manage_rep(old.sales_rep_id);
  else
    manager_move := false;
  end if;

  if rep_change and not manager_move and actor_role <> 'admin' then
    raise exception
      'Only an admin can reassign a dealer to a different sales rep';
  end if;

  if commercial_change and actor_role not in ('admin', 'finance') then
    raise exception
      'Only admin or finance can change a credit limit, account status or sales region';
  end if;

  return new;
end;
$$;

comment on function private.guard_dealer_commercial_columns() is
  'Column policing for browser writes to dealers. credit_limit, credit_limit_override, status and region are admin or finance. sales_rep_id is admin, or a sales manager moving a dealer to or from one of their own active reps, which is narrow on purpose: the manager cannot reach a dealer outside their team, so this cannot be used to take an account.';

-- A manager writing sales_rep_id directly, without the function, is now possible
-- where it was refused before. The policy is deliberately not widened for that: a
-- manager still has no UPDATE policy on dealers, so the guard's new branch is
-- reachable only through the function. That keeps one write path while the guard
-- still stands behind it. Verified in stage17 by asserting the direct update is
-- refused for a manager and the function is not.
