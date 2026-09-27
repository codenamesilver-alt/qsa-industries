-- Consolidate the tax code rules to one constraint per table.
--
-- 20260926093000 and 20260926100100 between them left two overlapping HSN
-- constraints on each of products and invoice_lines, and the pair that ended up
-- on products was not equivalent to either one alone:
--
--   products_hsn_code_format     hsn_code IS NULL OR hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'
--   products_hsn_code_required   hsn_code IS NOT NULL AND btrim(hsn_code) <> ''
--                                AND hsn_code ~ '^[0-9]{4,8}$'
--
-- The behaviour was correct, because the format constraint is also present and
-- it is the stricter of the two. But the redundancy was a trap rather than
-- tidiness: '^[0-9]{4,8}$' accepts 5- and 7-digit codes, which are not valid
-- HSN, so the moment products_hsn_code_format was dropped the looser regex
-- would have become the whole rule and invalid codes would have started
-- invoicing silently.
--
-- On invoice_lines the newer constraint added nothing at all:
--
--   invoice_lines.hsn_code is already NOT NULL
--   invoice_lines_hsn_code_check already rejects blank, because '   ' does not
--     match the digit pattern
--
-- So invoice_lines_hsn_code_required was a second statement of a rule already
-- enforced twice over.
--
-- This migration replaces both pairs with a single constraint each, keeping the
-- strict 4/6/8 digit pattern from the format constraints and the NOT NULL
-- requirement from the required ones. The rule is now one sentence per table
-- instead of two that have to be read together.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

-- Refused before anything is dropped, so a bad row blocks the migration rather
-- than being silently grandfathered through a constraint swap.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from public.products
   where hsn_code is null
      or btrim(hsn_code) = ''
      or hsn_code !~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$';

  if v_bad > 0 then
    raise exception
      'cannot consolidate: % product(s) carry a null, blank or non-conforming tax code',
      v_bad;
  end if;
end
$$;

alter table public.products
  drop constraint if exists products_hsn_code_format,
  drop constraint if exists products_hsn_code_required;

alter table public.products
  add constraint products_hsn_code_required
  check (
    hsn_code is not null
    and btrim(hsn_code) <> ''
    and hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'
  );

comment on constraint products_hsn_code_required on public.products is
  'A sellable product cannot be invoiced without a valid HSN code: required, non-blank, and 4, 6 or 8 digits.';

-- ---------------------------------------------------------------------------
-- invoice_lines
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from public.invoice_lines
   where hsn_code is null
      or btrim(hsn_code) = ''
      or hsn_code !~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$';

  if v_bad > 0 then
    raise exception
      'cannot consolidate: % invoice line(s) carry a null, blank or non-conforming tax code',
      v_bad;
  end if;
end
$$;

alter table public.invoice_lines
  drop constraint if exists invoice_lines_hsn_code_required;

-- The format constraint is left exactly as it was, and the column NOT NULL
-- declaration from 20260926093000 is left in place. Together they are the whole
-- rule: the column forbids absence, the pattern forbids a blank or malformed
-- code. The dropped constraint restated both and was not adding a third guard.
comment on constraint invoice_lines_hsn_code_check on public.invoice_lines is
  'An invoice line snapshot must carry a valid HSN code: 4, 6 or 8 digits. The column is also NOT NULL, so absence is refused by the column and malformation by this constraint.';
