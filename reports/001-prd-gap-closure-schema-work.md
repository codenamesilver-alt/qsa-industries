# Report 001 of 009 — PRD Gap Closure: Schema Work

> **To resume work:** pick the highest-numbered report in `reports/`. Read its
> "State at completion" and "Next milestone" sections, then continue from there.
> Reports are append-only and never renumbered.

| Field | Value |
| --- | --- |
| Report | 001 of 009 |
| Date | 26 September 2026 |
| Milestone | PRD gap closure, database schema layer |
| Status | Complete |
| Previous report | None (first in sequence) |
| Next report | `002-fresh-replay-clean.md` |

---

# QSA Industries ERP — Progress Report and Plan of Action

**Date:** 26 September 2026
**Repository:** `C:\Users\Moosi\Desktop\QSAINDUSTRIES`
**Branch:** `master` (no Git remote configured)
**Requirements source:** `docs/PRD.md`, build plan in `docs/BUILD_PLAN.md`

---

## 1. Summary

Today's work was concentrated on the database layer. Nine new migrations were written to close the gaps identified in the PRD review, and one of them has been applied to and verified on the live database. The remaining eight have not been applied yet.

The immediate priority is to re-run the fresh-database verification, which surfaced one error in the purchase order migration that has since been fixed but not yet re-tested, and which stopped the replay before it reached the batch tracking migration at all.

| Measure | Value |
| --- | --- |
| Migration files in the repository | 30 |
| Migrations applied to the live database | 22 |
| Migrations written today | 9 (versions `20260926093000` to `20260926093800`) |
| Migrations written today and applied live | 1 (`20260926093000`) |
| Migrations pending application | 8 |

---

## 2. What Was Done Today

### 2.1 Requirements and planning documents brought under version control

The product requirements document and the build plan were located outside the repository and copied in as `docs/PRD.md` and `docs/BUILD_PLAN.md`. They are currently untracked in Git and will be committed with the rest of the work. Having them in the repository means the requirements are now reviewed alongside the code rather than living in an external folder.

The PRD contained a number of explicitly open questions. The following were resolved and are now reflected in the schema:

- **Tally integration** is one-way, from the ERP to Tally, and the exact adapter will be built later. The direction is recorded in the export view; the format mapping is deliberately not attempted yet.
- **Raw material purchase orders are in scope.** This is the single largest addition of the day, described in section 2.6.
- **Invoice ageing must be configurable** rather than hard-coded, with a grace period and a decision about which invoice ages count toward the credit limit. Implemented in section 2.5.
- **Batch and lot expiry tracking is required.** Implemented in section 2.7.
- **A quality control staff role is required**, separate from the production manager. Implemented in section 2.2.

### 2.2 Quality control staff role

Two migrations add a `qc_staff` role to the user role enum and then apply the corresponding row level security policies:

- `20260926093100_qc_staff_role_enum.sql` — adds the enum value in its own transaction, because a value added to an enum cannot be used in the same transaction that adds it.
- `20260926093200_qc_staff_role_policies.sql` — grants quality control staff visibility of production runs and the ability to record quality control results, while explicitly denying them the ability to start or complete a production run. The existing production manager permissions are unchanged.

### 2.3 Requested delivery date and sales representative proxy ordering

`20260926093300_order_delivery_and_proxy.sql` replaces the dealer order function with a three-argument version that adds a requested delivery date and records which representative entered the order. This allows a sales representative to place an order on a mapped dealer's behalf, and allows an administrator to enter an order for a dealer directly. The function signature change means the order form in the web application must be updated to pass the new arguments; that work is still outstanding.

### 2.4 Dealer region

`20260926093400_dealer_region.sql` adds a region to the dealer record, tightens the update policy so that finance can adjust credit limits without being able to reassign a dealer's region or status, and adds a reporting view that aggregates by region.

### 2.5 Configurable invoice ageing

`20260926093500_credit_ageing_settings.sql` answers the PRD's open question about which invoice ages count toward the dealer credit limit. The settings table gains a grace period, three configurable ageing bucket boundaries, and a switch that determines whether invoices still inside the grace period count toward the limit. A new `dealer_invoice_ageing` view reports outstanding balances split across the buckets.

The chosen semantics are deliberately conservative. Every outstanding invoice continues to count toward exposure by default, so nothing is forgiven silently. The grace period classifies an invoice as current, meaning still within terms, so a credit manager can see how much of the exposure is genuinely overdue. Only when the switch is explicitly turned off do invoices inside the grace period stop counting, which returns the full limit to a dealer who is within terms. A trigger prevents bucket boundaries from crossing over, and the credit check function was rewritten to honour the new settings.

### 2.6 Raw material purchase orders

Two migrations add this capability, which was the largest single addition of the day.

`20260926093600_purchase_order_enums.sql` adds a `purchase` value to the stock movement source enum and creates the purchase order status enum. Both are in one file because neither can be used until the transaction commits.

`20260926093700_purchase_orders.sql` creates the purchase order and purchase order line tables, with row level security, and two functions: one to raise a purchase order, and one to receive against it.

The important design decision is that a goods receipt posts into the existing stock movement ledger as `source = 'purchase'`, referencing the purchase order. This keeps a single stock ledger rather than introducing a parallel one, so the product-level reconciliation that already passes its tests continues to pass, and a delivery remains distinguishable from a manual correction after the fact. Without purchase orders, the only way raw material entered stock was a manual adjustment, which meant there was no document to reconcile a supplier invoice against.

Line totals and order totals are derived by trigger and never typed in. Receipts validate that the quantity does not exceed the outstanding quantity on the line, reject lines belonging to a different purchase order, and move the order through a partial state when a delivery is short, so a short delivery stays visible instead of silently closing the order. The received quantity is written only by the receiving function and cannot be edited from the browser.

**Two bugs were found and fixed during writing, before the code was applied anywhere:**

1. The credit check inside the receive function assigned a boolean result to a numeric variable.
2. The receipt line lookup used an inner join, which would have silently discarded a line belonging to another purchase order and made an incomplete receipt look complete. This was changed to a left join with an explicit rejection.

### 2.7 Batch and lot tracking with expiry

`20260926093800_batch_lot_expiry.sql` adds optional batch tracking. The design is additive: the existing product-level stock ledger remains the single source of truth for availability, and batches engage only for products that actually have batches. A movement with no batch recorded is a movement for a product that is not batch tracked, which is what keeps the tracking genuinely optional as the PRD requires.

Expiry is enforced in two places. Dispatch uses first-expiry-first-out allocation and refuses to plan from an expired batch, and refuses to ship a partial quantity when the unexpired batches fall short. Separately, the dealer catalog subtracts expired stock from the quantity a dealer is allowed to order, so an expired batch is not sellable even before anyone reaches the dispatch screen.

The dispatcher function was rewritten to plan each order line against its batches before writing anything, so a shortfall aborts the whole dispatch rather than half-shipping it. An expiry reporting view classifies batches as expired, critical, warning, or fine, and a function records a batch receipt.

**This migration has not yet been executed even in a test environment.** The verification run stopped at the preceding purchase order migration.

### 2.8 GST, HSN codes and invoice lines (applied and verified)

This is the only migration from today that has been applied to the live database.

`20260926093000_gst_hsn_invoice_lines.sql` adds a tax code to each product, and a proper invoice line table that records the tax code and the individual tax components as a snapshot at the time of invoicing. Previously the tax calculation existed only as a single rate on the invoice header, which meant a mixed invoice could not be reconciled line by line and a change to the tax rate would silently rewrite the meaning of historical documents.

The invoice generation function was rewritten to populate the lines, the Tally invoice line view was added, and a constraint now enforces that the header totals and the line totals agree. A rounding allowance of one paisa is permitted for the split between the two state tax components, since the two cannot always be divided exactly.

**Verification results on the live database:**

- 16 invoices and 22 invoice lines present.
- Zero products without a tax code.
- Zero header and line reconciliation failures.
- All 5 pgTAP test suites pass.
- The audit script passes; exposure and stock figures are unchanged.

**Two points require your confirmation before this goes live for real invoicing.** Default tax codes were applied as `23099020` for poultry feed and `23099010` for other and raw material products; these must be confirmed against your actual product classification. Separately, the company state field is currently unset, and invoice generation therefore assumes intra-state supply and splits tax into the two state components. If any sale is inter-state, that assumption is wrong and must be corrected.

---

## 3. Verification State

The verification approach is to replay every migration into a brand new empty database before applying anything to the live one. This is the safety net for the whole effort, because several of the live migrations were applied early and must never be re-run.

**Latest fresh-database replay, run today:**

- 30 migrations discovered and attempted.
- 29 applied successfully, including the quality control role, proxy ordering, dealer region, ageing settings, and purchase order enums.
- **Failed at `20260926093700_purchase_orders.sql`** with the error `cannot use subquery in DEFAULT expression`.
- The cause was the column default `default (select auth.uid())`. PostgreSQL does not permit a subquery in a default expression; the existing tables use the bare function call.
- **The fix has been applied but not yet re-verified.**
- Because the replay stopped there, the batch and lot tracking migration was never executed even in the test environment.

Before anything else is applied to the live database, this replay must pass end to end.

**Previously verified state, unchanged by today's work:**

- All 5 pgTAP suites pass, 65 assertions.
- 24 fresh installation checks pass.
- The browser smoke suite covers 9 roles and 27 routes.
- The full order-to-payment lifecycle test passes, and the stock decrement reconciles exactly against the payment.

---

## 4. What Remains, Against the PRD

### 4.1 Apply and verify the pending migrations — highest priority

The eight pending migrations must pass a full fresh replay and then be applied to the live database, followed by the test and audit scripts. Nothing else should be built on top of an unverified schema.

### 4.2 Web application work

No frontend work has been done yet for any of today's schema changes. Specifically:

- Register the quality control role in the frontend role list, portal configuration, navigation, page access rules, and the quality control action panel.
- Add a tax code field to the product master, and display invoice lines with the tax breakup on the finance screen.
- Update the order form to pass the requested delivery date and the representative's proxy entry, and add a dealer selector with validation that the representative is actually mapped to that dealer.
- Add the ability to **edit** an order placed on a dealer's behalf. Today's function only creates orders; the PRD asks for placing and editing. The rules need deciding: presumably only pending orders, with price and stock recalculated.
- Add ageing bucket configuration to the finance settings screen, with a clear warning when the company state is unset.
- Add dealer region editing and regional reporting.
- Add purchase order screens: raise an order, view it, receive against it, and see partial deliveries.
- Add batch and lot screens: record a batch receipt, see batch stock, see expiry alerts, and see the first-expiry-first-out allocation preview on the dispatch screen.
- Add a responsive chart layer. No charting library is currently installed; the charts in the PRD need one added.

### 4.3 Admin master data console

There is no single screen for maintaining products, tax codes, dealers, regions, credit terms, price lists, users, roles, and the reporting hierarchy. Today these are spread across migrations and individual pages. A consolidated console is needed.

### 4.4 Production batch linkage

The production completion function does not yet create batches. Finished goods therefore arrive in stock without a batch code, so the expiry tracking is only fully useful once production output can be batched. This requires a signature change to the production completion function, which needs care because existing tests call it.

### 4.5 Tally export

The export view now carries tax codes and per-line tax values, but the consuming code and any tests that assert the export shape have not been reviewed against that change. The one-way direction and a decision record still need to be documented. The exact Tally version, import format, and GST numbering scheme are still unknown, so the adapter itself stays deferred as agreed.

### 4.6 Deployment and backups

Nothing exists yet for production hosting. Outstanding work: deployment configuration for Hostinger, HTTPS certificates, process management and service files so the application survives a reboot, and a scheduled database backup job. This is the largest remaining risk, because an ERP with no backups and no recovery plan is not safe to run in anger.

### 4.7 Continuous integration

A CI workflow file exists but has never executed, because there is no Git remote. Locally there is no Docker and no `psql`, so the containerised database job cannot be run either. Either a remote should be configured or the workflow should be adjusted to match what can actually be verified.

### 4.8 Smaller outstanding issues

- The order form displays a `NaN` quantity at one point in the lifecycle test. Persisted order totals are correct, so this is a display defect, but it needs fixing.
- The lifecycle test must be given a fresh quantity marker on each run, since it writes real stock movements.
- An assignment to the actor column inside an after-trigger cannot take effect. It is documented in the code rather than silently changed, because changing it would alter which existing rows carry an actor. This should be revisited deliberately.
- Invoice `QSA-2026-000040`, for `37675.00` against order `536aa0cb`, has no recorded author. Its origin needs confirming.
- A scratch database named `qsadb_probe` remains from earlier migration debugging. Cleanup failed with `database "qsadb_probe" is being accessed by other users` and should be retried.

---

## 5. Decisions Needed From You

These are the points where work is blocked on an answer rather than on effort.

1. **Product tax codes.** Confirm `23099020` for poultry feed and `23099010` for other and raw material products, or supply the correct classification. This is a statutory figure and should come from your accountant, not from me.
2. **Company state.** The state field is unset and intra-state supply is being assumed. Confirm the state, and whether any sales are inter-state.
3. **Ageing interpretation.** I implemented configurable thresholds, a grace period, and a switch for whether invoices inside the grace period count toward the credit limit. Confirm this matches your intent, particularly the credit limit behaviour.
4. **Edit on behalf.** Confirm the rules for editing a proxy order: which statuses are editable, and whether price and stock should be recalculated on edit.
5. **Tally specifics.** Version, import format, and numbering scheme, when you are ready to build the adapter.
6. **Invoice `QSA-2026-000040`.** Who created it, and should it stand?

---

## 6. Plan of Action

**Step 1 — Get the schema verified.** Re-run the fresh-database replay across all 30 migrations. Fix whatever it reports, including anything in the batch and lot tracking migration, which has never been executed. This step is not finished until the replay is completely clean.

**Step 2 — Apply to the live database.** Apply the eight pending migrations, then run the test suite and the audit script. Confirm the audit figures are unchanged from today's verified state.

**Step 3 — Add tests for the new behaviour.** The existing suites do not cover any of today's work. Tests are needed for quality control segregation of duties, proxy authorisation, requested delivery dates, region policies, tax code snapshots and tax reconciliation, ageing bucket boundaries and the grace period, purchase order receiving including the over-receipt and wrong-order rejections, and first-expiry-first-out allocation including the expired-batch refusal.

**Step 4 — Build the frontend for the schema already in place.** Quality control role wiring, product tax codes, invoice lines, proxy ordering and editing, requested delivery dates, ageing settings, region management, purchase orders, and batch and expiry screens.

**Step 5 — Add the chart layer and the admin master data console.** Install a charting library, build the dashboard charts the PRD asks for, and consolidate master data maintenance into one screen.

**Step 6 — Link production output to batches.** Change the production completion function to accept batch details, then update the tests that call it.

**Step 7 — Document the Tally direction.** Record the one-way decision and what the export view now provides, and review the export consumer against the changed view shape. Build the adapter only once the Tally specifics are known.

**Step 8 — Set up deployment and backups.** Hosting configuration, HTTPS, process management, and a scheduled backup job, then a restore test. Nothing goes into production use before the restore test passes.

**Step 9 — Close the small items.** The `NaN` display, the lifecycle test quantity marker, the actor assignment on triggers, the unidentified invoice, and the leftover scratch database.

**Step 10 — Full verification and commit.** A complete fresh replay, the full test suite, the smoke and lifecycle browser suites, the audit, and then a single local commit including the documentation, all migrations, and all application changes. Note that there is no Git remote, so a commit stays local until a remote is configured.

---

## 7. Working Practices to Keep

These are constraints that exist for a reason and should not be relaxed casually:

- **Never run `supabase db reset`.** The custom migration runner records whole migration files, and a reset would destroy data that cannot be reconstructed.
- **Never re-run the live backdated migrations** `20260925092200` or `20260925092400`. They are recorded as applied and re-running them would corrupt the order timeline.
- **Always replay into an empty database before applying to the live one.** This is the only thing standing between a bad migration and the live data.
- **Do not expose `.env.local` or any credentials.** The demo password in use is a local development value only and must be changed before any real deployment.
- **Do not build against an in-use `.next` directory.** Rebuild from the local environment file, or the build will serve placeholder pages.

---

## 8. Current Repository State

Branch `master`, no remote configured. All of today's work is uncommitted and shows as untracked:

- `docs/` (requirements and build plan)
- `supabase/migrations/20260926093000_gst_hsn_invoice_lines.sql` — applied live
- `supabase/migrations/20260926093100_qc_staff_role_enum.sql` — pending
- `supabase/migrations/20260926093200_qc_staff_role_policies.sql` — pending
- `supabase/migrations/20260926093300_order_delivery_and_proxy.sql` — pending
- `supabase/migrations/20260926093400_dealer_region.sql` — pending
- `supabase/migrations/20260926093500_credit_ageing_settings.sql` — pending
- `supabase/migrations/20260926093600_purchase_order_enums.sql` — pending
- `supabase/migrations/20260926093700_purchase_orders.sql` — pending, fixed but not re-verified
- `supabase/migrations/20260926093800_batch_lot_expiry.sql` — pending, never executed
