-- Police sales_rep_id, which 20260926100600 made writable without a rule.
--
-- 20260926100300 introduced private.guard_dealer_commercial_columns over four
-- columns: credit_limit, credit_limit_override, status and region. That was
-- sufficient while authenticated held no UPDATE grant on dealers at all, because
-- then no browser write of any kind could reach the table and the guard was only
-- ever exercised from the owner role in tests.
--
-- 20260926100600 granted that UPDATE, which is what the two dealers update
-- policies had been written for all along. It also turned sales_rep_id from an
-- unreachable column into a writable one, and nothing policed it:
--
--   * under dealers_update_scope a dealer editing their own row could have set
--     sales_rep_id, reassigning their own account to another rep, which moves
--     their credit exposure and account attribution with them.
--   * under dealers_update_internal finance could have reassigned any dealer.
--
-- The stage11 suite already documented the intended rule, in a comment attached
-- to an assertion that passed for the wrong reason: reassignment "has never been
-- writable by the application role, because reassigning a dealer between reps is
-- an admin decision". That assertion was checking for SQLSTATE 42501, so it was
-- really just re-proving the missing grant. The intent it recorded is correct, so
-- this migration makes it true rather than restating it.
--
-- So the guard is split in two rather than extended. The four commercial columns
-- keep the admin-or-finance rule and keep their original error message, because
-- existing tests and any operator reading a production log depend on that text.
-- sales_rep_id gets its own admin-only rule with its own message, so a refusal is
-- unambiguous about which rule was broken.

create or replace function private.guard_dealer_commercial_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role public.user_role;
  commercial_change boolean;
  rep_change boolean;
begin
  commercial_change :=
       new.credit_limit          is distinct from old.credit_limit
    or new.credit_limit_override is distinct from old.credit_limit_override
    or new.status               is distinct from old.status
    or new.region               is distinct from old.region;
  rep_change := new.sales_rep_id is distinct from old.sales_rep_id;

  -- A no-op write on any protected column is left alone, so a form that submits
  -- the full row does not fail just because it echoed the values back.
  if not (commercial_change or rep_change) then
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

  if rep_change and actor_role <> 'admin' then
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
  'Column policing for browser writes to dealers. credit_limit, credit_limit_override, status and region are admin or finance. sales_rep_id is admin only, because moving a dealer between reps moves their credit exposure and account attribution with them. A null actor role is a migration session and is allowed through.';
