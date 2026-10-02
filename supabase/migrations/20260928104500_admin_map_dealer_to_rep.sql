-- Mapping a dealer's sales rep from the onboarding board, which the dealer
-- onboarding flow needs and nothing implemented.
--
-- Why this exists. admin_activate_dealer refuses a dealer with no active rep,
-- because create_dealer_order reads dealers.sales_rep_id and orders.sales_rep_id
-- is not null, so an unmapped account cannot be ordered for by anyone. That
-- refusal is correct, but it left no way to satisfy it from the screen the
-- refusal appears on. The only writer of the column before
-- 20260928101000 was admin_upsert_dealer, which takes the entire dealer master:
-- name, address, status, credit limit, credit override, region, and the rep. So
-- the two available routes were both wrong for this job.
--
--   * admin_upsert_dealer from the onboarding board means resending every column
--     of a dealer whose master row the board view does not even carry, to change
--     one. A stale resend silently reverts whatever a finance user changed in the
--     meantime, and it routes an admin's rep change through a function whose
--     guard splits the commercial columns away from the rest, so a single
--     mis-set credit field is refused with a message about credit.
--   * A direct table update reaches the column guard rather than a named check,
--     and the guard is a boolean over four commercial columns plus this one. It
--     answers "not allowed" without saying which rep was refused or why.
--
-- So this is a narrow writer for one column, and the reason it is a function
-- rather than a grant is the same reason every write in this schema is a
-- function: a column grant cannot tell an admin from a dealer, and an admin is
-- not the only caller a table grant would reach.
--
-- Scope, deliberately narrow. This changes sales_rep_id and nothing else. It
-- cannot set a credit limit, cannot change the account status, cannot change the
-- region, and cannot create a dealer. Unassigning is allowed, because an admin
-- reassigning territory sometimes needs to leave a dealer in a holding state
-- between two reps, and because a dealer that was mapped to a rep who has since
-- left is better off unassigned than pointing at a disabled login. It is
-- asymmetric with sales_assign_dealer_to_rep, which refuses a null target, and
-- the asymmetry is not an oversight: that function is a manager moving accounts
-- inside their own team, where leaving a dealer unassigned takes it out of every
-- manager's reach and only an admin can get it back. This one is already the
-- admin.
--
-- The rep test is the same one admin_upsert_dealer applies, restated rather than
-- called, for the reason 20260928101000 gave about the guard: a rule that lives
-- in two places is two rules, and the next change to one of them is a silent
-- disagreement. Where the two must agree, the message is identical.

create or replace function public.admin_map_dealer_to_rep(
  p_dealer_id uuid,
  p_sales_rep_id uuid
)
returns public.dealers
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_row public.dealers%rowtype;
begin
  if private.current_user_role() is distinct from 'admin' then
    raise exception 'Only an admin can map a dealer to a sales rep';
  end if;

  select * into saved_row
  from public.dealers as d
  where d.id = p_dealer_id;

  if saved_row.id is null then
    raise exception 'No dealer with that id';
  end if;

  if p_sales_rep_id is not null and not exists (
    select 1
    from public.users as u
    where u.id = p_sales_rep_id
      and u.role = 'sales_rep'
      and u.is_active
  ) then
    raise exception 'A dealer must be mapped to an active sales rep';
  end if;

  if saved_row.sales_rep_id is not distinct from p_sales_rep_id then
    return saved_row;
  end if;

  update public.dealers
     set sales_rep_id = p_sales_rep_id
   where id = p_dealer_id
  returning * into saved_row;

  return saved_row;
end;
$$;

comment on function public.admin_map_dealer_to_rep(uuid, uuid) is
  'Point one dealer at one sales rep, changing no other column. Admin only. The target must be an active sales_rep, because create_dealer_order reads dealers.sales_rep_id and an account mapped to anyone else cannot be ordered for. Null is allowed here and refused by sales_assign_dealer_to_rep, because this is the admin path and a manager clearing a mapping would take the dealer out of every manager''s reach.';

revoke all on function public.admin_map_dealer_to_rep(uuid, uuid) from public;
revoke all on function public.admin_map_dealer_to_rep(uuid, uuid) from anon;

grant execute on function public.admin_map_dealer_to_rep(uuid, uuid) to authenticated;
