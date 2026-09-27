# Report 003 of 009 — Live Apply and Audit

| Field | Value |
| --- | --- |
| Report | 003 of 009 |
| Date | 26 September 2026 |
| Milestone | Eight pending migrations applied to the live database |
| Status | **Complete** |
| Previous report | `002-fresh-replay-clean.md` |
| Next report | `004-test-coverage-for-new-behaviour.md` |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

The live database now has all 30 migrations applied. The test suite passes, the
audit passes, every stock level still reconciles against its ledger, and dealer
exposure is unchanged at `90777.50`.

```
OK  20260926093100_qc_staff_role_enum.sql
OK  20260926093200_qc_staff_role_policies.sql
OK  20260926093300_order_delivery_and_proxy.sql
OK  20260926093400_dealer_region.sql
OK  20260926093500_credit_ageing_settings.sql
OK  20260926093600_purchase_order_enums.sql
OK  20260926093700_purchase_orders.sql
OK  20260926093800_batch_lot_expiry.sql

postgres now has 30 recorded migrations
PASS  day2_rls_test.sql                   (14 run, 0 failed)
PASS  stage3_inventory_test.sql           (12 run, 0 failed)
PASS  stage4_production_qc_test.sql       (14 run, 0 failed)
PASS  stage5_order_dispatch_test.sql      ( 9 run, 0 failed)
PASS  stage8_payment_allocation_test.sql  (16 run, 0 failed)
5/5 test files passed
```

---

## Safety snapshot taken before applying

No backup tooling exists in the project yet — that is milestone 8 — so a
pre-application snapshot was taken by exporting every base table in the `public`
schema to JSON.

| | |
| --- | --- |
| Location | `C:\Users\Moosi\AppData\Local\Temp\opencode\qsa-pre-migrate-20260926.json` |
| Size | 200.2 KB |
| Tables captured | 20 |
| Rows captured | 692 |

Contents: 6 dealers, 11 products, 13 users, 24 orders, 31 order items, 16
invoices, 22 invoice lines, 15 payments, 18 payment allocations, 127 stock
movements, 23 production runs, 31 tally exports, and the full user hierarchy.

This is a safety net for this one operation, not a backup strategy. It sits
outside the repository and would not survive losing the machine. Scheduled,
restorable backups remain outstanding work.

---

## Post-apply verification

Every new object was confirmed present on the live database, not merely recorded
as applied.

**Tables:** `product_batches`, `purchase_orders`, `purchase_order_lines`

**Views:** `dealer_invoice_ageing`, `expiring_batches`, `sales_by_region`

**Enums:**
- `user_role` now ends `... dealer, qc_staff`
- `purchase_order_status` is `draft, ordered, partially_received, received, cancelled`

**Function signatures:**
- `create_dealer_order(order_lines jsonb, p_requested_delivery_date date default null, p_dealer_id uuid default null)`
- `dispatch_order(target_order_id uuid, dispatch_date_value date default ..., dispatch_note text default ...)`
- `receive_purchase_order(p_purchase_order_id uuid, p_lines jsonb)`
- `receive_into_batch(p_product_id uuid, p_batch_code text, p_manufacture_date date, p_expiry_date date, p_quantity numeric, p_source stock_movement_source, p_reference_id uuid, p_reason text)`
- `update_finance_settings(p_gst_rate, p_company_state, p_ageing_grace_days, p_ageing_bucket_1_days, p_ageing_bucket_2_days, p_ageing_bucket_3_days, p_credit_counts_current_invoices, p_clear_ageing_buckets)`

**Quality control demo account:** `Ravi QC`, role `qc_staff`, active.

**Dealer regions:** West 3, East 1, South 1, North East 1. No dealer falls through
to `Unassigned` in the region report.

**Ageing settings:** grace period 0, buckets unset, current invoices counting —
the conservative defaults, as intended.

**Stock movement sources in use:** adjustment, opening_balance, production, sales.
The new `purchase` source is available but unused, which is correct: no purchase
order has been received yet.

---

## Audit figures, unchanged

| Measure | Value |
| --- | --- |
| Dealer exposure | 90777.50 |
| Open orders | 37762.50 |
| Invoice outstanding | 53015.00 |
| Unallocated advances | 0 |
| Orders | 24 |
| Invoices | 16 |
| Payments | 15 |
| Stock movements | 127 |
| Order events | 81 |
| Stock levels reconciling with their ledger | 11 of 11 |
| `QSA-BROILER-01` level and ledger | 1232.00 and 1232.00 |

Exposure and stock are identical to the pre-migration state, which is the point:
the eight migrations added capability without disturbing a single existing figure.

---

## What this milestone does not prove

Stating this plainly, because it is the honest position:

- **No test exercises any of the new behaviour.** The five existing pgTAP suites
  pass, but they do not know that purchase orders, batches, ageing buckets, proxy
  ordering or the quality control role now exist. They pass in the sense that
  nothing they already check was broken.
- **The batch and first-expiry-first-out path has never actually run.** It applies
  cleanly and its signature is correct, but the logic that splits a dispatch
  across batches and refuses to ship from an expired one has not been executed
  even once, on any database.
- **Purchase order receiving has never actually run.** Same position.
- **Ageing bucket boundaries have never been exercised**, including the trigger
  that is supposed to reject crossing boundaries.
- The two bugs caught by reading in the purchase order migration were not caught
  by a test. That is a strong argument for milestone 4 being treated as
  mandatory rather than optional.

---

## State at completion

| Measure | Value |
| --- | --- |
| Migration files | 30 |
| Applied to live | 30 of 30 |
| Fresh-install checks | 41 of 41 |
| pgTAP suites | 5 of 5 (65 assertions) |
| Suites covering the 20260926 features | **0** |
| Uncommitted files | 11 (9 migrations, `docs/`, `reports/`) |

## Notes carried forward

- The forward-only apply was safe because every migration had already replayed
  cleanly against an empty database in milestone 1. That is the entire reason
  the fresh replay exists; it is not a formality.
- Because the live database now has 30 migrations applied and two of the early
  ones are backdated and must never be re-run, the fresh replay remains the only
  safe way to test a schema change from this point on.
- Adding a ninth pgTAP suite will make `db:test` and `db:verify-fresh` both cover
  the new ground, which means the coverage arrives in both places at once.

## Next milestone

Write pgTAP coverage for everything added on 20260926, and let it run on both the
live database and the fresh install:

- quality control segregation of duties, including the denial of run start and
  completion
- proxy ordering, mapped-dealer validation, and the requested delivery date
- dealer region policies
- tax code snapshots and invoice header-to-line reconciliation
- ageing bucket boundary validation, the grace period, and the credit limit switch
- purchase order raising, partial receiving, over-receipt rejection, and rejection
  of a line belonging to another order
- batch receiving, first-expiry-first-out allocation, expired-batch refusal, and
  the requirement that batch tracking stays optional

The suite must fail loudly on a deliberately broken case, not only pass on a
correct one, otherwise it proves nothing.
