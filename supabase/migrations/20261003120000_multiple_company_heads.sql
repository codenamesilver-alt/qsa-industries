-- More than one head of the company, on the post model as well as the people model.
--
-- 20260928110000 refused a second top head twice over: a partial unique index named
-- org_positions_one_root, and a check inside admin_create_org_position. 20261003110000
-- dropped the index, because the people-based chart has no use for it -- a firm has a
-- CEO and partners, and the partners do not report to the CEO.
--
-- Dropping the index while leaving the check would have been the worst of the two:
-- the schema would have said two roots are fine and the function would have said
-- otherwise, and the second statement anybody reads would be the one that lies. So
-- the check goes too, and admin_move_org_position stops treating a null parent as a
-- refusal for the same reason.
--
-- What does not change: a post still needs a title, still needs a real parent when it
-- has one, still cannot be held by a dealer login, and a move still cannot put a post
-- above its own reports. The chart of posts is now optional furniture rather than the
-- company structure, and it is allowed to have several tops.

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

  -- A parent, when one is named, has to exist. A null parent no longer has to be the
  -- first one ever: several posts may sit at the top, because a company can have a
  -- chief executive and a partner who is not underneath them.
  if p_parent_id is not null and not exists (
    select 1 from public.org_positions where id = p_parent_id
  ) then
    raise exception 'No position with that id';
  end if;

  if p_user_id is not null and not exists (
    select 1 from public.users as u
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
  'Add one post to the chart, under a parent or at the top. Several posts may sit at the top: the single-root rule was removed in 20261003120000, because a firm has a chief executive and partners and the partners do not report to the chief executive. The person is optional, so a post can be created before it is filled, and must be a staff account: a dealer login is a customer, not an employee. New posts go to the end of their level.';

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

  -- No refusal on a null parent any more, for the same reason the create path lost
  -- its one-root check. Moving a post to the top is how a partner's post is set up.
  if p_new_parent_id = p_position_id then
    raise exception 'A position cannot report to itself';
  end if;

  if p_new_parent_id is not null and not exists (
    select 1 from public.org_positions where id = p_new_parent_id
  ) then
    raise exception 'No position with that id';
  end if;

  -- The one rule a move still has to carry: a post cannot be moved above its own
  -- reports, or the tree closes into a loop.
  if p_new_parent_id is not null and exists (
    with recursive below as (
      select op.id
        from public.org_positions as op
       where op.parent_id = p_position_id
      union all
      select child.id
        from public.org_positions as child
        join below on child.parent_id = below.id
    )
    select 1 from below where id = p_new_parent_id
  ) then
    raise exception 'That would put a position above its own reports';
  end if;

  if p_sort_order is null then
    update public.org_positions
       set parent_id = p_new_parent_id,
           sort_order = coalesce((
             select max(sibling.sort_order) + 1
               from public.org_positions as sibling
              where sibling.id <> p_position_id
                and sibling.parent_id is not distinct from p_new_parent_id
           ), 0)
     where id = p_position_id;
  else
    update public.org_positions
       set parent_id = p_new_parent_id,
           sort_order = p_sort_order
     where id = p_position_id;
  end if;
end;
$$;

comment on function public.admin_move_org_position(uuid, uuid, integer) is
  'Re-parent one post, optionally at a given position among its new siblings. A null parent is now a valid destination and means the top of the chart; the old rule that refused it is gone with the single-root index. A post still cannot be moved under itself or above anything that already reports to it.';

notify pgrst, 'reload schema';