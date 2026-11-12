# Tally export mapping

This document is a mapping stub. The database side of the Tally export is built
and tested; the Tally side cannot be finalised until the exact Tally version and
import file format are confirmed. Everything below that is marked **TODO**
depends on that answer.

## What is already built

| Object | Location | Purpose |
| --- | --- | --- |
| `public.tally_invoice_lines` | `database/migrations/20260925091700_stage10_tally_export.sql` | One row per invoice line, with header amounts repeated on the first line only |
| `public.tally_payment_lines` | same migration | One row per payment allocation, plus one row for any unallocated remainder |
| `public.record_tally_export(...)` | same migration | Records that an export was generated, who generated it, the period, the row count, and an optional checksum |
| `public.tally_exports` | same migration | Audit trail of every export ever generated |

Both views are `security_invoker` and additionally filter on
`private.current_user_role() in ('admin', 'finance')`, so row level security and
the view filter both have to agree for a row to be readable. `finance` and
`admin` can read the export views; no other role can, even directly.

## Invoice export

`public.tally_invoice_lines` produces one row per invoice line:

| Column | Source | Notes |
| --- | --- | --- |
| `invoice_number` | `invoices.invoice_number` | Also the Tally voucher reference |
| `invoice_date` | `invoices.invoice_date` | |
| `dealer_name` | `dealers.name` | Maps to the Tally ledger name |
| `dealer_email` | `dealers.email` | Not a Tally field; kept for matching and audit |
| `sku` | `products.sku` | Maps to an inventory item name |
| `product_name` | `products.name` | |
| `line_id` | `order_items.id` | Stable across exports; use it to detect changed lines |
| `quantity` | `order_items.quantity` | |
| `unit_price` | `order_items.unit_price` | |
| `line_total` | `order_items.line_total` | |
| `taxable_amount` | `invoices.taxable_amount` | Present **only on the first line** of each invoice |
| `gst_amount` | `invoices.gst_amount` | Present **only on the first line** of each invoice |
| `total_amount` | `invoices.total_amount` | Present **only on the first line** of each invoice |

The header amounts are emitted on the first line rather than repeated on every
line so that summing the column across an invoice gives the invoice total
exactly once. A Tally import that repeats header values on each line would
multiply the invoice total by the number of lines, so the importer must either
read the header from the first line only, or set the header on every line and
then blank it. This is a decision the importer has to make, and it is **TODO**.

Line numbering is assigned by `row_number()` over the order items of the invoice,
so it is positional and not a stored column.

## Payment export

`public.tally_payment_lines` produces one row per allocation:

| Column | Source | Notes |
| --- | --- | --- |
| `line_id` | `allocation:<uuid>` or `payment:<uuid>` | Prefix distinguishes an allocation row from an unallocated-remainder row |
| `payment_date` | `payments.payment_date` | |
| `export_date` | Allocation creation date, in `Asia/Kolkata` | Payment remainder rows use `payment_date` instead |
| `dealer_name` | `dealers.name` | |
| `invoice_number` | Allocated invoice, or the directly linked invoice | Null when an advance has no invoice yet |
| `amount` | Allocated amount, or `amount - allocated_amount` | |
| `mode` | `payments.mode` | Enum: `cash`, `bank_transfer`, `upi`, `cheque`, `other` |
| `reference` | `payments.reference` | Cheque or UTR number where available |

Payments are split into two kinds of row so that the export balances:

- An **allocation row** for every `payment_allocations` entry, carrying the
  invoice it was applied to.
- A **remainder row** for a payment whose `amount` exceeds the sum of its
  allocations, carrying the difference with a null invoice number.

This means a single payment can produce several rows. The `line_id` prefix is
what lets an importer group them back into one Tally receipt.

## Tally-side decisions still outstanding

Each of these is blocked on the Tally version and the import format QSA actually
uses. Confirm them before writing the exporter.

1. **Voucher type.** Sales invoices become Sales vouchers, but the payment rows
   could be Receipts vouchers, Contra vouchers against a bank ledger, or a
   Journal voucher. Cash, UPI, and cheque may need different ledgers. **TODO**
2. **Ledger names.** Tally ledgers are looked up by exact name, not by an id.
   The mapping from `dealers.name` to a Tally ledger name, and from
   `products.sku` to an inventory item, does not exist yet. **TODO**
3. **Godown or inventory quantity.** If Tally is maintaining quantities, the
   export must agree with the stock ledger. QSA's own stock is reconciled from
   `stock_movements`, and the restore check verifies that reconciliation, so the
   two ledgers have to be reconciled deliberately rather than assumed. **TODO**
4. **GST treatment.** The export carries a single `gst_amount` per invoice. Tally
   typically needs CGST and SGST split, and possibly a cess, at the ledger or
   tax-rate level. The split rule and rate come from `finance_settings.gst_rate`.
   **TODO**
5. **Accounting period and voucher numbering.** Tally numbers vouchers itself.
   `invoice_number` is carried as a reference for matching, but whether it
   should also drive the voucher number has to be decided. **TODO**
6. **Export format.** `public.tally_exports.format` accepts `csv` and `xml`,
   and the column names here are the CSV column names. Tally's own XML tag
   names are not the same as SQL column names, so the XML shape is a separate
   piece of work. **TODO**
7. **Period filtering.** `tally_exports.period_start` and `period_end` record
   what was exported, but neither view accepts a period filter. The exporter has
   to filter the view results itself, and the convention for an open period
   (a period that gets re-exported after a correction) needs to be written down.
   **TODO**

## Recording an export

Once a file is generated, record it so the audit trail is complete:

```sql
select public.record_tally_export(
  'csv',
  date '2026-09-01',
  date '2026-09-30',
  412,
  'exports/tally-2026-09.csv',
  'sha256:...'
);
```

The function is `security definer` and re-checks the caller's role, so a
non-finance caller gets `Only finance can record Tally exports` even if they
found a way to call it. Passing a blank storage path or checksum is allowed and
is stored as null.

## Verifying an export

The row count recorded in `tally_exports.row_count` should be checked against
the file before it is loaded into Tally, and the checksum recorded at the same
time is what makes that check repeatable later:

```sql
select
  e.created_at,
  e.format,
  e.period_start,
  e.period_end,
  e.row_count,
  e.storage_path,
  e.checksum,
  u.full_name as generated_by
from public.tally_exports as e
join public.users as u on u.id = e.generated_by
order by e.created_at desc;
```

## Current state

- The views, the recording function, the audit table, and their RLS policies are
  applied and covered by the pgTAP suites.
- A CSV exporter exists: `GET /api/tally/export?from=&to=` in
  `web/src/app/api/tally/export/route.ts`. It pages both views, filters the
  period itself, neutralises formula-like cells, returns the file with a
  `sha256` checksum header, and records the export through
  `public.record_tally_export`. Verified on 27 September 2026: finance and
  admin get 200 with 64 rows for September 2026, a dealer gets
  `403 Finance access required.`, and both successful calls left matching
  `tally_exports` rows.
- The exporter writes **CSV only**. Item 6 below is still open, so no XML has
  been generated.
- No Tally-side mapping has been validated against a real Tally installation, so
  no file has ever been loaded into Tally.
- Do not treat any part of the Tally integration as working until items 1 to 7
  above are answered and a round trip has been reconciled against Tally.

