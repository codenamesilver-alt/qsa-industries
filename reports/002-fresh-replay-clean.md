# Report 002 of 009 — Fresh Replay Clean

| Field | Value |
| --- | --- |
| Report | 002 of 009 |
| Date | 26 September 2026 |
| Milestone | Full fresh-database replay passing end to end |
| Status | **Complete** |
| Previous report | `001-prd-gap-closure-schema-work.md` |
| Next report | `003-live-apply-and-audit.md` |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

All 30 migrations now replay cleanly into a brand new empty database, all 41
fresh-install checks pass, and all 5 pgTAP suites pass against that fresh install.

This is the gate that had to clear before anything was applied to the live
database. It is now clear.

```
pass  all 30 migrations recorded
...
all 41 fresh install checks passed
PASS  day2_rls_test.sql                     (14 run, 0 failed)
PASS  stage3_inventory_test.sql             (12 run, 0 failed)
PASS  stage4_production_qc_test.sql         (14 run, 0 failed)
PASS  stage5_order_dispatch_test.sql        ( 9 run, 0 failed)
PASS  stage8_payment_allocation_test.sql    (16 run, 0 failed)
pass  pgTAP suites (5/5)
```

---

## What was fixed to get here

### 1. Illegal column default in the purchase order migration

`20260926093700_purchase_orders.sql` declared the purchase order author column as
`default (select auth.uid())`. PostgreSQL rejects a subquery in a default
expression:

```
cannot use subquery in DEFAULT expression
```

Changed to the bare function call `default auth.uid()`, which is what every
existing table in this schema already uses. This was the failure that stopped the
previous replay, and it also meant the batch migration had never been executed
even in a test environment.

### 2. Stale expected user count

The fresh-install check asserted 13 users. Migration `20260926093200` added the
quality control demo account, so the correct number is now 14. Updated, with a
comment recording which migration moved it so the next person does not have to
re-derive it.

### 3. Reconciliation check referenced a column that does not exist

The new invoice-line reconciliation check used `invoices.subtotal`. The actual
column is `taxable_amount`. The check now reconciles all three header figures
against the lines: taxable amount, total amount, and total tax. The tax
comparison sums the three tax components on each line, because a line splits tax
between the state and central components.

### 4. Six demo dealers had no region

The dealer region migration deliberately leaves the column nullable, on the
reasoning that assigning a real territory is a commercial decision and the
reporting view already falls back to state and then to `Unassigned`. That
reasoning is right for real dealers, but it left all six seeded demo dealers
unclassified, which makes the new region report impossible to evaluate.

Resolved by keeping the column nullable and backfilling only the six fixture
dealers, grouped geographically into four territories: West (Nashik and the two
Pune dealers), South (Kozhikode), East (Rajahmundry), North East (Shillong).
Real dealers are left unclassified for the sales team.

### 5. A check that asserted the wrong direction

The optionality check for batch tracking counted products that have *no* batch and
expected zero, which would only pass if every product were batch tracked — the
exact opposite of what optional means. Rewritten to count products that *do* have
a batch and expect zero, which is the real assertion: on a fresh install nothing is
batch tracked, so dispatch has to work against the product-level ledger alone.

---

## New checks added

The install checks went from 24 to 41. The 17 new ones exist so that a migration
which silently fails to create something is caught here rather than by a screen
that cannot load three weeks later.

| Area | Checks added |
| --- | --- |
| Tax codes | every product carries a tax code; every invoice line carries a tax code |
| Invoice lines | every invoice has at least one line; headers reconcile with lines on taxable amount, total, and tax |
| Quality control | `qc_staff` present in the enum; a `qc_staff` demo account exists |
| Regions | every seeded dealer has a region; the region report view exists; no dealer falls through to `Unassigned` |
| Ageing | all five ageing columns exist; the invoice ageing view exists |
| Batches | the expiry view exists; stock movements can reference a batch; batches start empty; no product is batch tracked |
| Catalog | the dealer catalog exposes a sellable quantity |
| Purchasing | purchase orders start empty |

The invoice header-to-line reconciliation is the most valuable of these. It is the
check that would catch a tax calculation drifting away from the lines it is
supposed to describe, which is exactly the failure mode that makes an invoice
 indefensible in an audit.

---

## State at completion

| Measure | Value |
| --- | --- |
| Migration files | 30 |
| Replaying cleanly on an empty database | 30 of 30 |
| Fresh-install checks | 41 of 41 passing |
| pgTAP suites | 5 of 5 passing (65 assertions) |
| Applied to the live database | 22 of 30 |
| Pending application | 8 (`20260926093100` to `20260926093800`) |

Live database figures are unchanged from the last verified state: 16 invoices, 22
invoice lines, no products without a tax code, no reconciliation failures, and
all 5 pgTAP suites passing.

## Notes carried forward

- The rewritten `dispatch_order` and the changed `dealer_catalog` view did not
  break any existing test. That is the first evidence that adding first-expiry-
  first-out allocation and a sellable quantity is compatible with the proven
  product-level ledger. It is evidence, not proof: the batch behaviour itself is
  not yet covered by a test, which is milestone 4.
- The two bugs found while writing the purchase order migration, a boolean
  assigned to a numeric and an inner join that would have silently dropped
  mismatched receipt lines, were caught by reading rather than by a test. That is
  exactly the class of defect milestone 4 needs to cover.
- Nothing has been applied to the live database in this milestone, and nothing
  should be until the next one.

## Next milestone

Apply the 8 pending migrations to the live database, then run the test suite and
the audit script, and confirm the audit figures are unchanged from today's
verified state. If the audit moves, stop and investigate before writing any
frontend code.
