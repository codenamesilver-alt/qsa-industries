-- Fix: a dealer could raise its own credit limit.
--
-- 20260926093400 added a sales region and, to let finance classify one, granted
--
--   grant update (region, credit_limit, credit_limit_override, status)
--     on table public.dealers to authenticated;
--
-- Column privileges are granted to a database role, and this schema has exactly
-- one application role: `authenticated`. The application role a person holds is a
-- value in users.role, not a PostgreSQL role. So that grant could not say "admin
-- and finance only" -- it said "everyone who can reach the row".
--
-- Who can reach a dealers row is decided by the policies, and one of them is
-- private.can_edit_dealer, which returns true for a dealer on its own record.
-- So the two together meant a dealer could rewrite its own commercial terms:
--
--   update dealers set credit_limit = 99999999 where id = <own dealer>;   -- succeeded
--   update dealers set status = 'active' where id = <own dealer>;          -- succeeded
--   update dealers set region = 'Mars' where id = <own dealer>;           -- succeeded
--
-- That defeats stage 6 outright. private.order_exposure and the credit check
-- are the mechanism that stops a dealer ordering past its limit, and the limit
-- was a column the dealer could raise for itself. It also let a dealer clear its
-- own suspension and reclassify its own sales territory.
--
-- credit_limit, credit_limit_override and status were not granted to
-- authenticated at all before this migration, so revoking the grant is not an
-- option either: the privilege check runs before the trigger, so revoking it
-- would stop finance from setting credit terms at all.
--
-- The guard therefore stays a trigger, and it is the only construct that can
-- express a per-application-role rule on a single database role.

create or replace function private.guard_dealer_commercial_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
begin
  if new.credit_limit is not distinct from old.credit_limit
     and new.credit_limit_override is not distinct from old.credit_limit_override
     and new.status is not distinct from old.status
     and new.region is not distinct from old.region
  then
    return new;
  end if;

  actor_role := private.current_user_role();

  -- A null role is a migration or maintenance session rather than an application
  -- user, and row level security has already refused it every dealers policy, so
  -- there is nothing to protect against. The region backfill in 20260926093400
  -- depends on this: it updates the column from a migration session.
  if actor_role is null then
    return new;
  end if;

  if actor_role not in ('admin', 'finance') then
    raise exception
      'Only admin or finance can change a credit limit, account status or sales region';
  end if;

  return new;
end;
$$;

comment on function private.guard_dealer_commercial_columns() is
  'Keeps credit_limit, credit_limit_override, status and region to admin and finance. Expressed as a trigger because the application role is a column, not a PostgreSQL role, so a column grant cannot distinguish them.';

drop trigger if exists dealers_guard_commercial_columns on public.dealers;

create trigger dealers_guard_commercial_columns
  before update on public.dealers
  for each row
  execute function private.guard_dealer_commercial_columns();

revoke all on function private.guard_dealer_commercial_columns() from public;
