-- Make the tax code mandatory, since the invoice is now built out of lines that
-- carry one.
--
-- 20260926093000 backfilled products.hsn_code and left the column nullable. That
-- was deliberate at the time -- the column and the backfill landed together, and
-- a NOT NULL on a column that is mid-migration is a nuisance -- but it left a
-- hole: a product created afterwards with no tax code would produce an invoice
-- line with a null code, which is precisely the document the whole migration
-- exists to make defensible.
--
-- The fresh-install check "every product carries a tax code" only proved the
-- seeded rows were filled in. It could not stop the next one.

alter table public.products
  add constraint products_hsn_code_required
  check (
    hsn_code is not null
    and btrim(hsn_code) <> ''
    and hsn_code ~ '^[0-9]{4,8}$'
  );

comment on constraint products_hsn_code_required on public.products is
  'A sellable product cannot be invoiced without a valid HSN code.';

-- The invoice line is a snapshot, so the same rule applies there. A null code on
-- a line means the product has been deleted or the line was written by something
-- other than generate_invoice, and neither is a document anybody should trust.
alter table public.invoice_lines
  add constraint invoice_lines_hsn_code_required
  check (hsn_code is not null and btrim(hsn_code) <> '');
