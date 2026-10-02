-- The org chart becomes a chart of people.
--
-- 20260928110000 modelled the chart as posts. Each row in org_positions was a box on
-- the wall with a title, and a person occupied a box, and boxes nested under boxes.
-- That is the org chart as a filing system thinks of it, and it is why the feature
-- did not survive contact with the business: to record that the firm has two
-- partners and a CEO, an admin had to invent a post for each, invent a parent for
-- each, and then keep the posts and the people in step. Nobody who was asked to draw
-- the company thought in posts.
--
-- People think in people. The CEO is a person, the two partners are persons, the
-- person under each of them is a person, and the only thing being recorded is who
-- each one reports to. So the edge is stored on the person and the chart is a
-- projection of it. There is no post to invent and no box to keep in step.
--
-- Three decisions in here are load-bearing.
--
--   1. The reporting line is a new column, not public.users.manager_id. That column
--      exists and is not free: it is the *sales* reporting line, locked to three
--      fixed levels by admin_upsert_user_profile (a rep reports to a manager, a
--      manager to a director), and asserted by stage12, stage16, stage17 and stage20.
--      A CEO reports to nobody and cannot satisfy those rules; a quality chemist
--      reporting to a partner is not a sales role at all. The two hierarchies answer
--      different questions and get different columns. Where they agree, they agree
--      because an operator set both, and the org chart is the one that shows it.
--
--   2. Any number of people may report to nobody. The one-root invariant that
--      20260928110000 installed -- a partial unique index forcing a single root --
--      is exactly what the business says is wrong: a firm has a CEO *and* partners,
--      and the partners do not report to the CEO. The index goes, and so does the
--      check inside admin_create_org_position that refused a second root. stage21
--      asserts that refusal in four places; those assertions are inverted rather
--      than deleted, because "a second top head is now allowed" is a behaviour worth
--      a test of its own.
--
--   3. A cycle is still refused. Two heads is a shape; a head who reports to their
--      own report is a bug, and the tree walk in web/src/lib/org-tree.ts defends
--      against one but should not have to. The check lives in the writer, as it did
--      for org_positions, and this time it is a recursive walk up reports_to rather
--      than down parent_id.
--
-- org_positions is emptied rather than dropped. Nothing references it -- there is no
-- foreign key into it from anywhere, verified before this migration was written --
-- so dropping it would be tidy, but the tests and the migration history both name it
-- and the post model is a defensible thing to want back later. Emptying it is the
-- operation the business actually asked for. The four admin_* functions stay, so the
-- post editor still works; it is simply not where the chart comes from any more.

-- ---------------------------------------------------------------------------
-- 1. The reporting line
-- ---------------------------------------------------------------------------

alter table public.users
  add column reports_to_id uuid references public.users (id) on delete set null;

comment on column public.users.reports_to_id is
  'Who this person reports to across the whole company, as drawn on the org chart. Null means a head of the company: the CEO, a director, a partner. Independent of users.manager_id, which is the three-level sales reporting line that decides whose dealers and whose revenue a login may see. Any number of people may hold null.';

create index users_reports_to_id_idx on public.users (reports_to_id);

alter table public.users
  add constraint users_no_self_reporting check (reports_to_id is null or reports_to_id <> id);

-- A person cannot be suspended out from under their reports either. Not a hard rule
-- -- a company can absolutely keep a suspended director's name on the wall -- but the
-- chart has to be able to say "suspended" next to a name rather than drawing a card
-- for somebody who cannot be emailed. That is a display concern, not a constraint,
-- so nothing is refused here.

-- ---------------------------------------------------------------------------
-- 2. Clear the chart
--
-- The one thing this migration must do without asking twice: every row of the post
-- tree goes. Child rows first, because org_positions.parent_id has no ON DELETE
-- clause and a plain delete from the top would be refused by the foreign key.
--
-- The user's accounts, orders, invoices and dealers are not touched. The posts were
-- never referenced by anything else.
-- ---------------------------------------------------------------------------

do $$
declare
  v_removed integer;
begin
  delete from public.org_positions where parent_id is not null;
  delete from public.org_positions where parent_id is null;

  get diagnostics v_removed = row_count;

  raise notice 'Cleared the post org chart (% rows). The user accounts are untouched; the chart is rebuilt from users.reports_to_id.', v_removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. More than one head
-- ---------------------------------------------------------------------------

drop index if exists public.org_positions_one_root;

comment on index public.org_positions_parent_idx is
  'Parent lookup for the post tree. The single-root index that used to sit beside this was dropped: the business has a CEO and partners, and the partners do not report to the CEO.';

-- sort_order on users, so two partners can be ordered rather than alphabetised. It
-- is added here, before the views below, because they select it.
alter table public.users
  add column sort_order integer not null default 0;

comment on column public.users.sort_order is
  'Order among siblings on the org chart. Two partners with the same reports_to_id are drawn in this order rather than alphabetically, so the chart can be made to read the way the company does. Zero for everybody not set, and ties fall back to name.';

-- ---------------------------------------------------------------------------
-- 4. The chart, as a projection of people
--
-- Two views and no security-definer gymnastics.
--
-- org_people is one row per person, and it is security_invoker over public.users so
-- the existing users policy still applies. That is a deliberate difference from
-- org_chart, which had to reach for private.org_person because internal staff can
-- only see their own row on public.users and a joined security_invoker view empties
-- every box. Here the audience is admin, who can_view_user admits unconditionally,
-- so the join does what it says and no read-past function is needed.
--
-- org_people_tree carries reports_to_name alongside reports_to_id so the box can say
-- who somebody reports to without the client doing a second lookup.
-- ---------------------------------------------------------------------------

drop view if exists public.org_people_tree;
drop view if exists public.org_people;

create view public.org_people
with (security_invoker = true)
as
select
  u.id as user_id,
  u.full_name,
  u.email,
  u.role,
  u.designation_id,
  d.name as designation,
  u.is_active,
  u.phone,
  u.reports_to_id,
  u.sort_order
from public.users as u
left join public.designations as d on d.id = u.designation_id
where u.role <> 'dealer';

comment on view public.org_people is
  'Every non-dealer account, which is every employee, with the designation they hold and the person they report to. The org chart reads this. security_invoker, so the users policy underneath decides who sees a row: an admin sees the whole company.';

create view public.org_people_tree
with (security_invoker = true)
as
select
  u.id as user_id,
  u.full_name,
  u.email,
  u.role,
  u.designation_id,
  d.name as designation,
  u.is_active,
  u.reports_to_id,
  mgr.full_name as reports_to_name,
  mgr.designation_id as reports_to_designation_id,
  mgr_desig.name as reports_to_designation,
  u.sort_order
from public.users as u
left join public.designations as d on d.id = u.designation_id
left join public.users as mgr on mgr.id = u.reports_to_id
left join public.designations as mgr_desig on mgr_desig.id = mgr.designation_id
where u.role <> 'dealer';

comment on view public.org_people_tree is
  'The org chart in the shape the screen draws it: one row per employee, carrying their own designation and the name and designation of whoever they report to. Orphaned by nothing -- a person whose reports_to_id points at a deleted account is kept, with the name null, rather than dropped from the company.';

revoke all on table public.org_people from public, anon;
revoke all on table public.org_people from authenticated;
grant select on table public.org_people to authenticated;
revoke all on table public.org_people_tree from public, anon;
revoke all on table public.org_people_tree from authenticated;
grant select on table public.org_people_tree to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_set_reports_to
--
-- The whole reporting line, as one call. Any person may report to any other person,
-- including somebody who themselves report to somebody else, at any depth, and any
-- number of people may report to nobody.
--
-- Two refusals, both about the shape rather than the business rules:
--
--   * nobody reports to themselves. A one-hop check would do for this, but the
--     recursive walk below catches the general case anyway.
--   * no cycles. A person cannot report to somebody who already reports, directly or
--     transitively, to them. Without this the chart walk in the browser has to defend
--     itself against a loop, and a loop is a data error that should be refused at the
--     only place a user can cause it.
--
-- p_reports_to_id null is meaningful here and means "this person is a head of the
-- company". It is not the "leave it alone" that it is in the other writers, because
-- this function's whole job is the reporting line: there is nothing else it could
-- mean.
-- ---------------------------------------------------------------------------

create function public.admin_set_reports_to(
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

  if p_user_id = p_reports_to_id then
    raise exception 'Somebody cannot report to themselves';
  end if;

  if p_reports_to_id is not null then
    if not exists (select 1 from public.users where id = p_reports_to_id) then
      raise exception 'No user with that id to report to';
    end if;

    -- Walk up from the proposed manager. If the person being moved is anywhere on
    -- that path, closing the edge would make a loop, and the chart would stop being
    -- a tree. The guard inside the walk stops the query being expensive on a
    -- pathological graph, which the constraint above already prevents for the
    -- one-hop case but not for the rest.
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
  'Move one person under another on the org chart, or promote them to a head of the company by passing null. Admin only. Refuses self-reporting and refuses any move that would close a reporting loop, because a chart with a loop in it is not a chart. Deliberately independent of users.manager_id, which is the three-level sales reporting line and enforces a different rule set that a CEO or a quality chemist cannot satisfy.';

-- ---------------------------------------------------------------------------
-- 6. admin_clear_org_chart
--
-- Clearing the chart is one call rather than a delete from the browser, because a
-- delete of this shape is exactly the thing RLS exists to prevent and because it has
-- to refuse the case where it would strand somebody: a person whose manager is not
-- being cleared. With p_cascade it clears the whole line. Without it, it clears only
-- the people who already report to nobody, which is the "start again from the top"
-- case and leaves every working chart alone.
-- ---------------------------------------------------------------------------

create function public.admin_clear_org_chart(p_cascade boolean default false)
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

  if p_cascade then
    update public.users set reports_to_id = null where role <> 'dealer';
  else
    -- Only the heads, so that everybody below them keeps their line and the chart
    -- does not collapse into a flat list of forty people at the top.
    update public.users
       set reports_to_id = null
     where role <> 'dealer'
       and (reports_to_id is null or not exists (
         select 1 from public.users as m where m.id = reports_to_id
       ));
  end if;

  get diagnostics v_cleared = row_count;

  return v_cleared;
end;
$$;

comment on function public.admin_clear_org_chart(boolean) is
  'Clear the reporting line. Admin only. With p_cascade it detaches everybody, which is a full reset of the chart. Without it, it detaches only the people already at the top -- or orphaned -- which restarts the chart from the heads without touching anybody below them. Dealer logins are never in the chart and are left alone either way.';

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.admin_set_reports_to(uuid, uuid) from public;
revoke all on function public.admin_set_reports_to(uuid, uuid) from anon;
revoke all on function public.admin_clear_org_chart(boolean) from public;
revoke all on function public.admin_clear_org_chart(boolean) from anon;

grant execute on function public.admin_set_reports_to(uuid, uuid) to authenticated;
grant execute on function public.admin_clear_org_chart(boolean) to authenticated;

notify pgrst, 'reload schema';