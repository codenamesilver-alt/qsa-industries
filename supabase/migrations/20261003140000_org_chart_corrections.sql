-- Two corrections to the people chart, both found by stage23 rather than by reading.
--
--   1. A dealer login could be put at the head of the company chart.
--   2. admin_clear_org_chart had a second mode that could not do anything, and its
--      return value counted rows it had not changed.
--
-- Neither is a design change. Both are the difference between a guard existing and a
-- guard being reachable.
--
-- ---------------------------------------------------------------------------
-- 1. A dealer is a customer, and cannot be anybody's manager
--
-- admin_set_reports_to checks that the proposed manager is a row in public.users and
-- stops there. Every other read of the company excludes dealers --
-- private.org_people_rows() has "and u.role <> 'dealer'",
-- admin_clear_org_chart has "where role <> 'dealer'", and the views inherit both --
-- so a dealer could be named as the person somebody reports to, and the line was
-- then invisible: the manager's own row is filtered out of org_people_tree, so the
-- box said "Reports to" with nothing after it, and the subtree hung off a person the
-- chart does not draw.
--
-- That is a data error a portal user can cause, which is the only kind worth fixing
-- in the writer. The refusal is separate from the existence check so the message
-- says what is actually wrong: the id is real, it is just not somebody who works
-- for the company.
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

  -- Nobody reports to themselves. A dealer account cannot be moved either, so
  -- this runs before the self check rather than after it: the two answers to
  -- "who is this person" are the same question.
  if exists (select 1 from public.users where id = p_user_id and role = 'dealer') then
    raise exception 'A dealer login is not part of the company chart';
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
  'Move one person under another on the org chart, or promote them to a head of the company by passing null. Admin only. Refuses a dealer login on either end, refuses self-reporting, and refuses any move that would close a reporting loop, because a chart with a loop in it is not a chart. Deliberately independent of users.manager_id, which is the three-level sales reporting line and enforces a different rule set that a CEO or a quality chemist cannot satisfy.';

-- ---------------------------------------------------------------------------
-- 2. One clear, and a count of what it changed
--
-- The parameter is going away rather than being made to work, because the second
-- mode had nothing to do:
--
--   p_cascade false updated every employee whose reports_to_id was already null.
--   Setting a null column to null. The heads of the company are the people who
--   report to nobody, so "detach the people who report to nobody" is a no-op on
--   every chart that exists, and the one other thing in the branch -- a person whose
--   manager row has gone -- is already handled by the on delete set null clause on
--   the foreign key, so that row has a null too.
--
-- Keeping it would have been keeping a function that reports success. The single
-- remaining operation is real, so the parameter that asked for an imaginary second
-- one goes with it. The signature changes, which is why the old one is dropped
-- rather than replaced: there is no default that makes both calls mean the same
-- thing.
--
-- The return value changes too, and this is the half that mattered in the bug. The
-- old version counted the rows the UPDATE touched, which for the no-op branch was
-- every employee already at the top: the screen would have announced "17 people
-- cleared" having changed nothing. It is now the number of reporting lines actually
-- removed, so the number on the message is the number of boxes that moved.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_clear_org_chart(boolean);

create function public.admin_clear_org_chart()
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
   where role <> 'dealer'
     and reports_to_id is not null;

  get diagnostics v_cleared = row_count;

  return v_cleared;
end;
$$;

comment on function public.admin_clear_org_chart() is
  'Clear the reporting line: every employee becomes a head of the company. Admin only. Returns the number of reporting lines actually removed, not the number of rows visited. Dealer logins are never in the chart and are left alone. There is no partial mode; 20261003110000 had one and it could not do anything.';

revoke all on function public.admin_clear_org_chart() from public;
revoke all on function public.admin_clear_org_chart() from anon;
grant execute on function public.admin_clear_org_chart() to authenticated;

notify pgrst, 'reload schema';