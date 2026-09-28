-- Corrects private.region_of, which 20260928100000 defined with nullif(x, '').
--
-- nullif only catches the zero length case, so a region holding '   ' -- which is
-- what a text input produces when someone types spaces and submits, and what a
-- CSV import produces routinely -- is not treated as unset. It becomes a region
-- literally named with three spaces. That is worse than a cosmetic bug: the dealer
-- stops falling back to their state, so they group into a separate bucket, the
-- regional totals no longer reconcile with the dealer book, and the group sorts
-- nowhere useful. The function's own comment claimed whitespace was handled, and
-- stage16 assertion 3 caught the claim being false.
--
-- A separate migration rather than an edit to 100000, because that file is already
-- applied to the target database. Editing it would make a fresh replay build a
-- different schema from the one running, which is the exact drift the append-only
-- rule exists to prevent.

create or replace function private.region_of(target_dealer_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(d.region), ''),
    nullif(btrim(d.state), ''),
    'Unassigned'
  )
  from public.dealers as d
  where d.id = target_dealer_id
$$;

comment on function private.region_of(uuid) is
  'Reporting region for a dealer: own region, else state, else ''Unassigned''. '
  'Both are btrimmed, so a whitespace-only value counts as unset rather than '
  'becoming its own group.';
