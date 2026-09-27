# Report 004 of 009 — Test Coverage for New Behaviour

| Field | Value |
| --- | --- |
| Report | 004 of 009 |
| Date | 27 September 2026 |
| Milestone | pgTAP coverage for everything added on 20260926, plus five migrations |
| Status | **Complete** |
| Previous report | `003-live-apply-and-audit.md` |
| Next report | `005-*.md` (not yet written) |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

The sixth pgTAP suite exists, passes on both the live database and a clean fresh
install, and has been shown to fail when the behaviour it covers is removed. Five
new migrations were written and applied along the way, three of them fixing
defects that reading the code had not caught.

```
postgres now has 35 recorded migrations
PASS  day2_rls_test.sql                   (14 run,  0 failed)
PASS  stage11_compliance_procurement_test.sql (113 run, 0 failed)
PASS  stage3_inventory_test.sql           (12 run,  0 failed)
PASS  stage4_production_qc_test.sql       (14 run,  0 failed)
PASS  stage5_order_dispatch_test.sql      ( 9 run,  0 failed)
PASS  stage8_payment_allocation_test.sql  (16 run,  0 failed)
6/6 test files passed (178 assertions)

all 41 fresh install checks passed
```

---

## What report 003 said was missing, and where it is now covered

Report 003 listed eight areas with no coverage. All eight are now exercised.

| Area from report 003 | Assertions |
| --- | --- |
| Quality control segregation of duties | production run start and completion denied to `qc_staff`; produced quantity, run date and author not writable; the QC update guard also refuses a privileged writer; BOM not editable |
| Proxy ordering | proxy creates an order for a mapped dealer; unmapped user refused; requested delivery date honoured and defaulted |
| Dealer region policies | finance reclassifies a region; a sales rep cannot; no dealer falls through to `Unassigned` |
| Tax code snapshots and invoice reconciliation | line `hsn_code` equals the product at invoice time; header total equals the sum of lines; header tax equals the sum of line tax |
| Ageing buckets, grace period, credit switch | bucket boundaries persisted; cleared buckets are null; grace period drops the invoice side of exposure; the switch never increases exposure; restoring terms restores the figure exactly |
| Purchase orders | raising, partial receiving, over-receipt rejection, a line from another order refused, and the untouched line still reads zero |
| Batch receiving and FEFO | later batch received first, then the earlier one; allocation is earliest-expiry-first; expired batch refused; direct ledger read hidden from a dealer |
| Batch tracking stays optional | the batched product is the only one that requires a batch, and an unbatched dispatch is untouched |

---

## Defects found and fixed by writing the tests

Four of these are real behaviour bugs. None of them was caught by applying the
migrations; all four surfaced the first time something executed the code.

### 1. Purchase order total was always one line behind — `20260926100000`

`20260926093700` recalculated the order total from a `BEFORE INSERT` trigger on
`purchase_order_lines`. A `BEFORE` trigger runs before the row is visible to the
statement's own snapshot, so the sum it read excluded the line being inserted.
A two-line order of `4500.00` and `3100.00` reported `4500.00`.

The line total was correct, because that part only writes to `NEW` and never
reads. That is the worst shape for this bug: the arithmetic on screen still looks
plausible, so a purchase order for the wrong amount is entirely believable.

Fix: the line total stays `BEFORE` because it only writes `NEW`; the order total
moves to `AFTER`, where the row exists.

### 2. Partial receipts never showed as partial — `20260926100400`

`20260926093700` derived "anything received" with
`coalesce(bool_and(quantity_received > 0), false)` — "did *every* line receive
something". A receipt that touched one line and left another untouched therefore
left the order reading `ordered` while stock had already been received against
it. It should be `bool_or`.

This survived being applied to a live database because a receipt touching every
line takes the correct branch by accident.

### 3. Every application user was locked out of batches — `20260926100200`

`20260926093800` created `product_batches` with no row level security and no
grant to `authenticated`. Both `expiring_batches` and `dealer_catalog` are
`security_invoker = true`, so they run as the caller: every user, in every role,
would have received `permission denied for table product_batches`. The dealer
catalogue — the thing a dealer actually sees — was dead on arrival.

Fix: row level security with a staff-only select policy, no client writes, and a
`security definer` aggregate that `dealer_catalog` uses so it can show a sellable
quantity without exposing the ledger.

### 4. A dealer could raise its own credit limit — `20260926100300`

This is the serious one. `20260926093400` granted `UPDATE` on
`region, credit_limit, credit_limit_override, status` to the single PostgreSQL
role `authenticated`, because a column grant cannot tell admin from finance from
dealer. `private.can_edit_dealer` lets a dealer reach its own row. The two
together meant any dealer could set its own limit and then order against it.

Confirmed on the live database before fixing, dealer
`4637f04f-aed6-44bc-82d8-774991079d1d` on its own account:

```
credit_limit            -> 99999999   rows=1
credit_limit_override   -> 99999999   rows=1
status                  -> changed    rows=1
region                  -> changed    rows=1
```

A credit limit that a customer can edit is not a credit limit.

Fix: a `BEFORE UPDATE` trigger comparing old and new values, permitting the
commercial columns only to `admin` and `finance`. It stays a trigger because the
application role is a column, not a PostgreSQL role, so no grant can express the
rule. The trigger is deliberately narrow — a dealer can still maintain its own
contact details, and writing a commercial column to the value it already holds is
not an error.

After applying:

```
credit_limit          -> P0001 Only admin or finance can change a credit limit, account status or sales region
credit_limit_override -> P0001 (same)
status                -> P0001 (same)
region                -> P0001 (same)
name                  -> rows=1   (dealer still maintains its own details)
```

Coastal Agri Enterprises is unchanged: limit `300000.00`, override null, status
`active`, region `East`.

### 5. Product tax code was nullable — `20260926100100`

`20260926093000` backfilled `products.hsn_code` and left the column nullable. The
fresh-install check "every product carries a tax code" only proved the seeded rows
were filled in; it could not stop the next one. A product created afterwards with
no code would produce an invoice line with no code, which is the document the
migration exists to make defensible.

---

## The suite was made to fail on purpose

Report 003 required that the suite "must fail loudly on a deliberately broken
case". Each control was disabled in turn on the scratch database and stage11
re-run, so every failure below is attributable to one migration. Each break was
then repaired by re-applying that migration's own file.

```
baseline: 113 assertions, 0 failed

BREAK  20260926100000 purchase order total (back to BEFORE timing)
       suite aborted:  expected a derived total of 7600.00, got 4500.00
       repaired -> 113 assertions, 0 failed

BREAK  20260926100400 partial receipt status (bool_and again)
       not ok  a short delivery on one line leaves the whole order partially received
       repaired -> 113 assertions, 0 failed

BREAK  20260926100200 batch read access (no grant, no policy)
       suite aborted:  permission denied for table product_batches
       repaired -> 113 assertions, 0 failed

BREAK  20260926100300 dealer commercial column guard (trigger disabled)
       not ok  a dealer cannot raise its own credit limit
       not ok  a dealer cannot set its own credit limit override
       not ok  a dealer cannot suspend its own account
       not ok  the dealer account is still active after the refused suspension
       not ok  a dealer cannot reclassify its own sales region
       repaired -> 113 assertions, 0 failed

final: 113 assertions, 0 failed
```

Note 34 is the one worth reading twice. It does not assert that an error was
raised; it asserts the account is still `active`. With the guard disabled the
dealer reached `suspended` — `have: suspended, want: active` — so the test proves
the escalation was prevented rather than merely reported.

Two of the four breaks abort the suite instead of printing `not ok`, because the
failure is a hard error at the point of use: a `BEFORE` trigger total is caught by
a `RAISE EXCEPTION` in a `DO` block, and revoked privileges are a privilege error
rather than a failed assertion. Both are loud, which is the requirement, but they
do not name the assertion that broke.

---

## Assertions that were wrong, not the code

Worth recording separately, because the failure mode is the dangerous one: a test
that passes for the wrong reason.

- **`lives_ok` on an `UPDATE` proves nothing.** An update that matches no row
  does not raise, so three finance assertions passed whether or not finance could
  write at all — they would have gone green against the exact regression they
  exist to catch. They now assert the stored value. The same flaw was found and
  fixed in the sales rep region assertion.
- **Expecting `42501` where the design uses row level security.** `qc_staff`
  editing the bill of materials and a sales rep editing a dealer region are both
  refused by policy, matching no row, not by privilege. The assertions were
  rewritten to compare stored values. Asserting a privilege error the design
  deliberately does not use would have tested a control that does not exist.
- **A status probe that changed nothing.** Setting a dealer's status to `active`
  when it is already `active` is a no-op, and the guard correctly stays quiet. The
  probe now suspends, which is the change that would actually stop trading.
- **An ageing test that could not fail.** The grace-period assertion named a
  dealer whose invoices are fully settled on a fresh replay, so there was no
  invoice exposure to remove and both sides of the comparison were identical. The
  test now selects the dealer with the largest live balance and derives the grace
  period from the newest open invoice — the grace period counts invoices *older*
  than the cutoff, so using the oldest invoice left it exactly on the boundary.
- **Casting a composite to text.** `receive_into_batch` returns a whole
  `product_batches` row. `::text` yields every column, so the FEFO assertions
  could never have passed and were not testing allocation. They select
  `.batch_code` out of the row now.
- **`is()` against `NULL`.** pgTAP's `is()` reports a failure when either side is
  null, so a cleared ageing bucket was asserted as a null check.
- **A data-modifying CTE inside an assertion.** Not allowed; rewritten to capture
  the starting value and compare afterwards.

---

## Also found by reading, not by testing

- `product_batches` had no `GRANT`, so the `expiring_batches` report was
  unreachable for every role including admin.
- The FEFO allocator `private.allocate_batches_fefo` and the batch quantity
  triggers were executable by `public`. They are no longer.

---

## Redundancy worth cleaning up later

Not a defect, but two overlapping tax code constraints now exist and the newer one
is partly weaker.

| Constraint | Definition | Verdict |
| --- | --- | --- |
| `products_hsn_code_format` (20260926093000) | `hsn_code IS NULL OR hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'` | allows null; 4, 6 or 8 digits |
| `products_hsn_code_required` (20260926100100) | `hsn_code IS NOT NULL AND btrim(...) <> '' AND hsn_code ~ '^[0-9]{4,8}$'` | closes the null hole, but `^[0-9]{4,8}$` also admits 5- and 7-digit codes, which are not valid HSN |
| `invoice_lines_hsn_code_check` (20260926093000) | `hsn_code ~ '^[0-9]{4}([0-9]{2})?([0-9]{2})?$'` | rejects blank already |
| `invoice_lines_hsn_code_required` (20260926100100) | `hsn_code IS NOT NULL AND btrim(...) <> ''` | **fully redundant** — the column is already `NOT NULL` and the check above already rejects whitespace |

The effective product rule is correct, because the stricter format constraint is
also present. But if `products_hsn_code_format` were ever dropped, the newer
constraint would silently accept 5- and 7-digit codes. Worth collapsing to one
constraint per table in a later milestone. Not changed here, because the
migrations are already applied and forward-editing an applied migration is worse
than carrying a redundant constraint.

---

## Live apply

Five migrations were applied after the fresh replay was green.

```
target postgres @ aws-0-ap-northeast-1.pooler.supabase.com: 30 applied, 5 pending

OK  20260926100000_purchase_order_total_fix.sql               (679ms)
OK  20260926100100_product_hsn_required.sql                  (654ms)
OK  20260926100200_batch_read_access_and_sellable_stock.sql  (677ms)
OK  20260926100300_dealer_commercial_columns_guard.sql        (642ms)
OK  20260926100400_purchase_order_partial_status_fix.sql     (642ms)

postgres now has 35 recorded migrations
```

Before applying, a JSON snapshot was taken to
`C:\Users\Moosi\AppData\Local\Temp\opencode\qsa-pre-apply-snapshot.json`. As in
report 003, this is a safety net for one operation, not a backup strategy.

### Data unchanged by the apply

| Table or measure | Before | After |
| --- | --- | --- |
| Dealers | 6 | 6, every column identical |
| Users | 14 | 14, identical |
| Stock levels | 11 | 11, identical |
| Stock movement totals | 20 groups | 20 groups, identical |
| Products (excluding the new `hsn_code`) | 11 | 11, identical |
| Invoice lines (excluding the new `hsn_code`) | 22 | 22, identical |
| Purchase orders | 0 | 0 |
| Product batches | 0 | 0 |
| Stock movements | 127 | 127 |
| Orders / invoices | 24 / 16 | 24 / 16 |
| Dealer exposure | 90777.50 | 90777.50 |
| Stock levels reconciling with their ledger | 11 of 11 | 11 of 11 |

Every figure matches report 003. The migrations added capability and closed
defects without moving a single number.

The pre-apply snapshot's `invoices` and `orders` exports failed on a column that
does not exist (`invoices.status`), so those two tables were compared by row count
and by the audit's exposure figures rather than field by field. The five
migrations do not reference either table.

### Constraints proven to reject, not merely to exist

```
BLOCKED products hsn_code = ''    : 23514 violates products_hsn_code_format
BLOCKED products hsn_code = 'ABC' : 23514 violates products_hsn_code_format
BLOCKED products hsn_code = null  : 23514 violates products_hsn_code_required
BLOCKED invoice_lines hsn_code = null  : 23502 not-null constraint
BLOCKED invoice_lines hsn_code = '   ' : 23514 violates invoice_lines_hsn_code_check
```

All 11 products and all 22 invoice lines carry a valid code.

---

## What this milestone does not prove

- **No UI was exercised.** Every assertion is at the SQL boundary. The screens for
  batch receiving, purchase orders, the credit override and the QC verdict have
  never been opened against this schema.
- **The proxy-order and batch paths were run only inside a rolled-back
  transaction.** They have never written a permanent row. That is the right way to
  test them and the wrong way to prove the workflow end to end.
- **Two of the four deliberate breaks abort the suite rather than naming a failed
  assertion**, noted above.
- **The `authenticated` role is a single role for every application user.** Every
  control in this milestone is expressed as a trigger or a policy precisely
  because no grant can distinguish admin from finance from dealer. That works, but
  it means privileges are not visible in the schema the way a per-role grant would
  be, and a future reviewer will have to read the trigger bodies to know what a
  role can do.
- **No scheduled, restorable backup exists.** Still milestone 8.

---

## State at completion

| Measure | Value |
| --- | --- |
| Migration files | 35 |
| Applied to live | 35 of 35 |
| Fresh-install checks | 41 of 41 |
| pgTAP suites | 6 of 6 (178 assertions) |
| Suites covering the 20260926 features | 1 of 1 (113 assertions) |
| Defects found by writing the tests | 5 |
| Deliberate breaks proven to fail | 4 of 4 |
| Uncommitted files | 18 entries (14 migrations, `supabase/tests/stage11_...`, `docs/`, `reports/`, and a modified `scripts/db-verify-fresh.mjs`) |

## Notes carried forward

- Three of the five defects here were only findable by executing the code.
  `20260926093700` had been applied to a live database and read carefully without
  either bug surfacing. Treat new migrations as unproven until something runs them.
- The fresh replay remains the only safe way to test a schema change, for the same
  reason as in report 003: two early migrations are backdated and must never be
  re-run.
- The scratch database is dropped after each verification. It is left in place
  only while investigating, and `--keep` is what leaves it.
- `set local role` does not accept bind parameters. Use
  `select set_config('request.jwt.claim.sub', $1, true)` in any future probe, or
  the statement fails with `42601 syntax error at or near "$1"`.

## Next milestone

Report 003 also listed the following as still outstanding, none of it touched
here:

- consolidate the overlapping tax code constraints
- scheduled, restorable backups
- the user interface against the new schema
- and whatever `docs/BUILD_PLAN.md` schedules after milestone 4
