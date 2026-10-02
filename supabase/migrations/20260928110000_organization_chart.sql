-- The organization chart, which the portal asked for and no table could hold.
--
-- Why this is a table and not a column somewhere. An org chart is a tree of posts
-- with a person on each, and the portal already has a tree of people:
-- public.user_hierarchy, which is the *sales reporting line* and nothing else. It
-- is three levels deep, it is fixed by role, and it exists to answer "whose
-- accounts are these". An org chart answers "who works under whom", and it has to
-- be free to be a different shape on every org change: a CEO, a director, three
-- managers, somebody wearing two hats. Reusing user_hierarchy would force every
-- org change into a schema change, and would put a sales rep's commission line in
-- the same row as a department head. So this is a separate tree, and nothing in
-- user_hierarchy moves.
--
-- Three deliberate choices in the shape:
--
--   * title is free text, not the role enum. A post and a permission are different
--     things: "CEO", "Director", "Head of Production" and "QC Staff" are posts,
--     while public.user_role decides what an account may do. An admin can hold the
--     admin permission and the title CEO, and that has to be drawable without a
--     migration. A chart that can only hold the enum is a chart that needs a
--     migration every time the company hires.
--
--   * user_id is nullable and there is no unique constraint on it. A post can be
--     vacant (someone is being hired, or has just left) and one person can hold
--     two posts, which is normal and not an error. The pickers warn about the
--     second case; the database does not refuse it, because a company that cannot
--     record a fact it operates under is worse off than one duplicate name in a
--     box.
--
--   * user_id is on delete set null and parent_id has no on delete clause. Two
--     asymmetries on purpose. Deleting an auth row releases the post and leaves an
--     empty box, because a chart that loses the manager's box when they leave is
--     worse than one that shows a vacancy. Deleting a parent is *refused* by both
--     the foreign key and the RPC below, because cascading would delete a whole
--     branch of the company in one statement on the strength of one click.
--
-- ---------------------------------------------------------------------------
-- private.is_internal_staff()
--
-- True for an active account on one of the six internal roles. Built on
-- current_user_role(), which already returns null for a suspended account, so a
-- suspended login loses the chart along with everything else. Dealer logins and
-- the sales roles are not internal staff: the chart describes the company, and a
-- dealer's account is a customer account.
-- ---------------------------------------------------------------------------

create or replace function private.is_internal_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.current_user_role() in (
    'admin',
    'production_manager',
    'inventory_manager',
    'qc_staff',
    'logistics',
    'finance'
  )
$$;

comment on function private.is_internal_staff() is
  'True for an active account holding an internal role. The six roles are the ones the internal portal admits; a dealer login and a sales login are not staff, and a suspended account is not staff either, because current_user_role() is null for it.';

create table public.org_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  parent_id uuid references public.org_positions (id),
  user_id uuid references public.users (id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_positions_no_self_parent check (parent_id is null or parent_id <> id)
);

comment on table public.org_positions is
  'The organization chart: one row per post, self-referencing through parent_id. Read by internal staff, written only through the four admin_* functions below. Titles are free text and are not the role enum.';

create index org_positions_parent_idx on public.org_positions (parent_id);
create index org_positions_user_idx on public.org_positions (user_id);

-- One top head. The expression is a constant on purpose: a unique index on
-- parent_id alone would not do it, because nulls are distinct in a unique index,
-- so every root row would be seen as different from every other root row.
create unique index org_positions_one_root
  on public.org_positions (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where parent_id is null;

create trigger org_positions_set_updated_at
  before update on public.org_positions
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- private.org_person(target_user_id)
--
-- The name behind a box in the chart, read past the users RLS.
--
-- private.can_view_user shows a login its own row, an admin every row, and a
-- sales login only its own chain. Internal staff fall through to "its own row",
-- so every one of them would see the chart with six names missing and their own
-- repeated six times: a joined security_invoker view is filtered by the users
-- policy underneath it, so the join empties the boxes rather than naming them.
-- The alternative, opening public.users to internal staff, is wider than the
-- chart needs, because that table also carries phone numbers, dealer links and
-- the reporting line, and it would be reachable by anything holding a session.
--
-- So this grants names, not rows, on the same terms private.sales_display_name
-- does. It returns a card for one person, and no row at all when the caller is
-- not internal staff or the target is not an employee, so a dealer who reaches
-- the function by name gets an empty answer rather than a staff directory.
-- ---------------------------------------------------------------------------

create or replace function private.org_person(target_user_id uuid)
returns table (full_name text, email text, role public.user_role, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.full_name, u.email, u.role, u.is_active
  from public.users as u
  where u.id = target_user_id
    and u.role <> 'dealer'
    and private.is_internal_staff()
$$;

comment on function private.org_person(uuid) is
  'Name, email, role and active flag for one person on the org chart, read past the users RLS that hides every other row from internal staff. One row, or none: no row when the caller is not internal staff, and none for a dealer login, which is a customer account rather than an employee.';

revoke all on function private.org_person(uuid) from public;
grant execute on function private.org_person(uuid) to authenticated;

-- The picker list, which is the same card for every employee. Assembled from
-- org_person rather than repeated, so the guard and the dealer exclusion live in
-- one place: a second list written here would be a second staff directory, and
-- the two would disagree the first time a role was added.
create or replace function private.org_staff_roster()
returns table (user_id uuid, full_name text, email text, role public.user_role, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, person.full_name, person.email, person.role, person.is_active
  from public.users as u
  cross join lateral private.org_person(u.id) as person
$$;

comment on function private.org_staff_roster() is
  'Every employee account, active or suspended, for the org chart pickers. Excludes dealer logins and everything the caller is not entitled to see. Suspended people are listed on purpose: the post they held is still on the chart and the picker has to be able to say so.';

revoke all on function private.org_staff_roster() from public;
grant execute on function private.org_staff_roster() to authenticated;

-- ---------------------------------------------------------------------------
-- The chart. security_invoker, so the org_positions policy underneath decides who
-- sees a row, and the person names come from org_person rather than a join, for
-- the reason given above.
-- ---------------------------------------------------------------------------

create view public.org_chart
with (security_invoker = true)
as
select
  p.id,
  p.title,
  p.parent_id,
  p.sort_order,
  p.user_id,
  person.full_name as user_full_name,
  person.email as user_email,
  person.role as user_role,
  person.is_active as user_is_active
from public.org_positions as p
left join lateral private.org_person(p.user_id) as person on true;

comment on view public.org_chart is
  'The org chart as the screen reads it: every post with its parent, its order among its siblings, and the person on it. Names come from private.org_person, so the view is not emptied by the users RLS. security_invoker, so only internal staff can read it.';

-- The picker list, as a view rather than a bare call. private.org_staff_roster
-- cannot be reached over PostgREST, because the private schema is not exposed, and
-- a view is how every other read in this schema reaches a private helper.
--
-- security_invoker, so the EXECUTE on org_person is checked against the reader
-- rather than against this view's owner. That is stricter than it needs to be:
-- the guard inside org_person reads auth.uid(), which comes from the request and
-- not from the current role, so the answer is the same either way. Stricter was
-- worth having.
create view public.org_staff_roster
with (security_invoker = true)
as
select r.user_id, r.full_name, r.email, r.role, r.is_active
from private.org_staff_roster() as r;

comment on view public.org_staff_roster is
  'Every employee account for the org chart pickers, including suspended ones, and excluding dealer logins. security_invoker over private.org_staff_roster, so a reader who is not internal staff gets no rows rather than the whole company.';

revoke all on table public.org_staff_roster from anon, authenticated;
grant select on table public.org_staff_roster to authenticated;

alter table public.org_positions enable row level security;

drop policy if exists org_positions_read_internal on public.org_positions;
create policy org_positions_read_internal
on public.org_positions
for select
to authenticated
using (private.is_internal_staff());

revoke all on table public.org_positions from anon, authenticated;
grant select on table public.org_positions to authenticated;

revoke all on table public.org_chart from anon, authenticated;
grant select on table public.org_chart to authenticated;

-- ---------------------------------------------------------------------------
-- The four writers. A function and not a grant, for the reason every write in this
-- schema is a function: a table grant cannot tell an admin from a QC user, and an
-- admin is not the only caller a grant would reach.
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_org_position(
  p_parent_id uuid,
  p_title text,
  p_user_id uuid default null
)
returns public.org_positions
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.org_positions%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the organization chart';
  end if;

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'A position needs a title';
  end if;

  if p_parent_id is null then
    if exists (select 1 from public.org_positions where parent_id is null) then
      raise exception 'The chart already has a top head. Add positions below it instead';
    end if;
  else
    if not exists (select 1 from public.org_positions where id = p_parent_id) then
      raise exception 'No position with that id';
    end if;
  end if;

  if p_user_id is not null and not exists (
    select 1
    from public.users as u
    where u.id = p_user_id
      and u.role <> 'dealer'
  ) then
    raise exception 'A position can only be held by a staff account, and no staff account has that id';
  end if;

  insert into public.org_positions (title, parent_id, user_id, sort_order)
  values (
    trim(p_title),
    p_parent_id,
    p_user_id,
    coalesce((
      select max(sibling.sort_order) + 1
      from public.org_positions as sibling
      where sibling.parent_id is not distinct from p_parent_id
    ), 0)
  )
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_create_org_position(uuid, text, uuid) is
  'Add one post to the chart, under a parent or as the top head. Only the first call may pass a null parent, because the chart has exactly one top head. The person is optional, so a post can be created before it is filled, and must be a staff account: a dealer login is a customer, not an employee. New posts go to the end of their level.';

-- A move is the only writer that can make the tree cyclic, so it carries the walk.
-- Restated from private.is_ancestor_or_self rather than reused, because that one
-- walks public.user_hierarchy and this table is a different tree; sharing it would
-- make "reports to" mean two things depending on which table the argument came
-- from.
create or replace function public.admin_move_org_position(
  p_position_id uuid,
  p_new_parent_id uuid,
  p_sort_order integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the organization chart';
  end if;

  if not exists (select 1 from public.org_positions where id = p_position_id) then
    raise exception 'No position with that id';
  end if;

  if p_new_parent_id is null then
    raise exception 'The chart has one top head. Move a position below another instead';
  end if;

  if p_new_parent_id = p_position_id then
    raise exception 'A position cannot report to itself';
  end if;

  if not exists (select 1 from public.org_positions where id = p_new_parent_id) then
    raise exception 'No position with that id';
  end if;

  if exists (
    with recursive below as (
      select id from public.org_positions where parent_id = p_position_id
      union
      select p.id
      from public.org_positions as p
      join below on p.parent_id = below.id
    )
    select 1 from below where id = p_new_parent_id
  ) then
    raise exception 'That would put a position above its own reports';
  end if;

  update public.org_positions
     set parent_id = p_new_parent_id,
         sort_order = coalesce(
           p_sort_order,
           (
             select max(sibling.sort_order) + 1
             from public.org_positions as sibling
             where sibling.parent_id = p_new_parent_id
               and sibling.id <> p_position_id
           ),
           0
         )
   where id = p_position_id;
end;
$$;

comment on function public.admin_move_org_position(uuid, uuid, integer) is
  'Re-parent one post, and optionally set where it sits among its new siblings; null appends it. Refuses a move onto itself, a move that would put a post above its own reports, and any move to the top, because the top head is chosen once and changed by clearing the chart.';

-- The same rule for a person: a rename or a re-assignment is one call, so the
-- post cannot end up with a new name and an old occupant. A null p_user_id is not
-- a request to clear the post, it is a request to change nothing, so clearing is
-- its own flag. That reads worse than a single nullable argument and is the point:
-- "absent" and "empty" are different instructions and a screen should be able to
-- send each one.
create or replace function public.admin_update_org_position(
  p_position_id uuid,
  p_title text default null,
  p_user_id uuid default null,
  p_clear_user boolean default false
)
returns public.org_positions
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.org_positions%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the organization chart';
  end if;

  select * into saved_row
  from public.org_positions
  where id = p_position_id;

  if saved_row.id is null then
    raise exception 'No position with that id';
  end if;

  if p_title is not null and char_length(trim(p_title)) = 0 then
    raise exception 'A position needs a title';
  end if;

  if p_clear_user then
    saved_row.user_id := null;
  elsif p_user_id is not null then
    if not exists (
      select 1
      from public.users as u
      where u.id = p_user_id
        and u.role <> 'dealer'
    ) then
      raise exception 'A position can only be held by a staff account, and no staff account has that id';
    end if;

    saved_row.user_id := p_user_id;
  end if;

  update public.org_positions
     set title = coalesce(nullif(trim(p_title), ''), saved_row.title),
         user_id = saved_row.user_id
   where id = p_position_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_update_org_position(uuid, text, uuid, boolean) is
  'Rename a post, put a person on it, or take the person off it, in one call. p_clear_user is separate from a null p_user_id because a null argument means "leave the occupant alone" and clearing has to be askable. The person must be a staff account.';

-- The delete is the only destructive call in the portal, so it carries two
-- guards instead of one. Without the cascade flag, a post with anything below it
-- is refused and the admin deletes bottom-up. With it, only the top head can be
-- deleted, which is the one move that can only ever clear the whole chart: a
-- branch in the middle of the company can never disappear in a single statement,
-- however the call arrives.
create or replace function public.admin_delete_org_position(
  p_position_id uuid,
  p_cascade boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  below_count integer;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can change the organization chart';
  end if;

  if not exists (select 1 from public.org_positions where id = p_position_id) then
    raise exception 'No position with that id';
  end if;

  select count(*) into below_count
  from public.org_positions
  where parent_id = p_position_id;

  -- The count is tested and then not used in the message. It is the one thing that
  -- tells the two refusals apart, and a message that read "still has 1 positions
  -- below it" would be a worse sentence than no count at all.
  if below_count > 0 and not p_cascade then
    raise exception 'This position still has positions below it. Delete or move them first';
  end if;

  if p_cascade and not exists (
    select 1 from public.org_positions where id = p_position_id and parent_id is null
  ) then
    raise exception 'Only the whole chart can be deleted at once. Delete the positions below it individually';
  end if;

  with recursive subtree as (
    select id from public.org_positions where id = p_position_id
    union
    select p.id
    from public.org_positions as p
    join subtree on p.parent_id = subtree.id
  )
  delete from public.org_positions
  where id in (select id from subtree);
end;
$$;

comment on function public.admin_delete_org_position(uuid, boolean) is
  'Remove one post, or with p_cascade the entire chart from the top head down. A post with reports is refused unless it is the top head, so no branch of the chart can be deleted in one call; the top head is the single exception because clearing the chart and starting again is a real thing an admin needs to do. The person on the post keeps their login.';

revoke all on function public.admin_create_org_position(uuid, text, uuid) from public;
revoke all on function public.admin_create_org_position(uuid, text, uuid) from anon;
revoke all on function public.admin_move_org_position(uuid, uuid, integer) from public;
revoke all on function public.admin_move_org_position(uuid, uuid, integer) from anon;
revoke all on function public.admin_update_org_position(uuid, text, uuid, boolean) from public;
revoke all on function public.admin_update_org_position(uuid, text, uuid, boolean) from anon;
revoke all on function public.admin_delete_org_position(uuid, boolean) from public;
revoke all on function public.admin_delete_org_position(uuid, boolean) from anon;

grant execute on function public.admin_create_org_position(uuid, text, uuid) to authenticated;
grant execute on function public.admin_move_org_position(uuid, uuid, integer) to authenticated;
grant execute on function public.admin_update_org_position(uuid, text, uuid, boolean) to authenticated;
grant execute on function public.admin_delete_org_position(uuid, boolean) to authenticated;
