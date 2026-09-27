# Report 005 of 009 — Grants, Backup Proof, and the UI Against the New Schema

| Field | Value |
| --- | --- |
| Report | 005 of 009 |
| Date | 27 September 2026 |
| Milestone | Three migrations, restorable backups, deployment assets, and the first UI run against the 20260926 schema |
| Status | **Complete** |
| Previous report | `004-test-coverage-for-new-behaviour.md` |
| Next report | `006-*.md` (not yet written) |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

Everything report 004 said was unproven is now exercised, and the three
migrations written alongside it are applied. The suite is green on the live
database, on a clean replay, and on a restored backup, and the screens for
purchasing, quality, proxy ordering, dealer credit and batch receiving have been
driven in a real browser as signed-in users of each role.

```
postgres now has 38 recorded migrations

live database
PASS  day2_rls_test.sql                       ( 14 run,  0 failed)
PASS  stage11_compliance_procurement_test.sql (157 run,  0 failed)
PASS  stage3_inventory_test.sql               ( 12 run,  0 failed)
PASS  stage4_production_qc_test.sql           ( 14 run,  0 failed)
PASS  stage5_order_dispatch_test.sql          (  9 run,  0 failed)
PASS  stage8_payment_allocation_test.sql      ( 16 run,  0 failed)
6/6 test files passed (222 assertions)

fresh replay        all 41 fresh install checks passed
restored backup     all 31 restore checks passed
web                 eslint clean, tsc --noEmit clean, next build 22 routes
ui:smoke            10 roles, every allowed route 200 and every other route refused
ui:lifecycle        11 flows, order f536bd3c placed, dispatched, invoiced and paid in full
```

Dealer exposure after the whole milestone, including a full lifecycle run, is
`90777.50` — the same figure as reports 003 and 004.

---

## The defect behind `20260926100600`

The stage11 suite added in report 004 tested the two `dealers` UPDATE policies by
resetting the session to the owner role. It passed. It was also proving nothing,
because a row level security policy is a row filter, not a permission.

Postgres checks the table privilege before it ever consults RLS, and
`authenticated` held only `SELECT` on `dealers`. So `dealers_update_internal`
and `dealers_update_scope` were unreachable, and the two features written
behind them — finance setting a credit limit or a region, and a dealer editing
their own contact details — had never once run as a signed-in user.

The same mistake was not confined to one table. Twelve write policies across the
schema were inert for want of a grant:

| Table | Policy | What was dead |
| --- | --- | --- |
| `dealers` | `dealers_update_internal`, `dealers_update_scope` | finance credit and region override, dealer self-service |
| `production_runs` | `production_runs_update_internal` | `production-qc-actions.tsx` performs a direct `.update({ qc_status, qc_notes })`, so the QC verdict could never have succeeded from a browser |
| `products` | `products_update_threshold` | replenishment thresholds |
| `users` | `users_update_self` | profile self-service |
| `purchase_orders` | `purchase_orders_write_internal` | inert by design, see below |
| `purchase_order_lines` | `purchase_order_lines_write_internal` | inert by design |

Four grants are blanket table grants and three are column grants, because a
table grant would have been an escalation on its own:

```
grant update on public.dealers to authenticated;
grant update (qc_status, qc_notes) on public.production_runs to authenticated;
grant update (low_stock_threshold) on public.products to authenticated;
grant update (full_name, phone) on public.users to authenticated;
```

`users` is the sharpest of these. Its row filter is "my own row", so granting
the whole table would have let any signed-in user set their own `role` to
`admin`. `role`, `is_active` and `dealer_id` are not granted. Likewise
`products` gets the threshold column and not `price`, `is_sellable`, `hsn_code`,
`name` or `category`.

`purchase_orders` and `purchase_order_lines` are left alone on purpose. Every
write to them goes through a `SECURITY DEFINER` function, which runs as the
owner and is not subject to these policies, so the policies are inert rather
than wrong. They are kept for a future `SECURITY INVOKER` path, and a `comment
on table` now says so, because a reader would otherwise take their presence as
evidence that a browser can write there.

`raw_materials` is the third shape: already genuinely browser-writable for the
internal roles its policy names, and deliberately not granted `DELETE`, so the
narrower grant is what stops a browser orphaning production history.

### The escalation the grant opened, closed separately

Granting `UPDATE` on `dealers` also made `sales_rep_id` writable, and nothing
policed it. Under `dealers_update_scope` a dealer editing their own row could
have reassigned their own account to another rep, which moves their credit
exposure and their attribution with it; under `dealers_update_internal` finance
could have reassigned any dealer.

The stage11 suite already recorded the intended rule in a comment attached to an
assertion that passed for the wrong reason — reassignment "has never been
writable by the application role, because reassigning a dealer between reps is
an admin decision" — while checking for SQLSTATE `42501`, which only re-proved
the missing grant. `20260926100700` makes the recorded intent true: the four
commercial columns keep the admin-or-finance rule and their original error text,
and `sales_rep_id` gets its own admin-only rule with its own message, so a
refusal names the rule that was broken. The test now asserts the stored value in
both directions, so the column is admin-writable rather than merely frozen.

---

## `20260926100500` — the constraint consolidation report 004 recommended

Report 004 recorded two overlapping HSN constraints per table as a trap rather
than untidiness: the pair that ended up on `products` was not equivalent to
either constraint alone, and `^[0-9]{4,8}$` would have silently accepted 5- and
7-digit codes the day the stricter format constraint was dropped. This migration
replaces each pair with one constraint, keeping the strict 4/6/8 digit pattern
and the `NOT NULL` requirement:

| Table | Before | After |
| --- | --- | --- |
| `products` | `products_hsn_code_format` (allows null) + `products_hsn_code_required` (admits 5 and 7 digits) | `products_hsn_code_check` — not null, 4/6/8 digits |
| `invoice_lines` | `invoice_lines_hsn_code_check` + a fully redundant `_required` | `invoice_lines_hsn_code_check` |

`scripts/hsn-mutation-check.mjs` (`npm run db:mutation-hsn`) was added to prove
this by mutation rather than by reading the constraint: it breaks the rule, shows
the write is rejected, repairs it from the migration file, and shows the write
is accepted.

---

## Backups that have been restored

This was milestone 8 on report 004's outstanding list, and it is the item that
was worth doing before anything else, because everything after it is easier to
undo when a restore has been proven.

`db:backup` writes a data-only logical dump of every public table to
`backups/qsa-<UTC timestamp>.sql`, rendered by PostgreSQL itself rather than by
the script, ending with `setval` for every sequence. It prunes on every run:
newest 20 kept, anything older than 14 days dropped.

`db:restore-check` is the part that matters. It builds a throwaway database,
replays all 38 migrations, truncates the seeded rows, loads the dump in one
transaction with `session_replication_role = replica`, then runs 31 checks and
drops the database:

- every table's row count against the manifest the dump recorded **when it was
  taken**, not against the live database, so a concurrent write cannot cause a
  false failure;
- all 42 foreign keys in the public schema, counted as actual orphan rows, which
  is what proves the load was legitimate — enforcement is off during the load
  because `orders` ↔ `invoices` and `users` ↔ `dealers` are mutually deferrable-
  less and neither constraint can be checked mid-load;
- the stock ledger reconciliation, the invoice sequence sitting past the highest
  invoice issued, no reused invoice number, every invoice still having its lines,
  no order pointing at a missing invoice;
- all six pgTAP suites, 222 assertions, against the restored copy.

Verified today on the live project: two dumps written, 31 of 31 checks passed,
scratch database dropped. `--restore-to <name>` performs the same work and keeps
the result, which is the incident-recovery path.

---

## Deployment assets, not yet a deployment

`deployment/` holds `deploy.sh`, `ecosystem.config.cjs`, `nginx.conf` and a
README with server setup, rollback, backup scheduling, monitoring and the secret
rotation list. The deploy order is deliberate and documented in both the script
and the README:

```
backup -> verify backup -> install -> migrate -> build -> reload -> health check
```

The backup is proven restorable *before* any migration runs, because a backup
taken after a migration is worthless. The build happens after the migration so
the running app is never serving code that expects a column the database does not
have yet; every migration in this repository is additive, so old code tolerates
the new schema, which is the direction that makes this safe.

**Nothing in `deployment/` has been run against a real server.** No VPS exists and
no domain points at this app, so the first deploy is a rehearsal.

---

## The user interface, exercised for the first time

Report 004 ended with "no UI was exercised" as its first limitation. That is now
closed for the 20260926 features. New screens and components:

| File | What it is |
| --- | --- |
| `web/src/app/internal/purchasing/page.tsx` | raise a purchase order, receive against it |
| `web/src/app/internal/quality/page.tsx` | QC queue and verdict entry |
| `web/src/components/purchase-order-form.tsx` | order header and lines |
| `web/src/components/purchase-order-receive-form.tsx` | partial receipt, over-receipt refused |
| `web/src/components/batch-receive-form.tsx` | receive into a lot with an expiry date |
| `web/src/components/dealer-credit-form.tsx` | finance credit and region override |
| `web/src/components/finance-settings-form.tsx` | ageing grace period |
| `web/src/components/proxy-order-form.tsx` | sales rep ordering for a mapped dealer |

`ui:smoke` now signs in as ten roles, the tenth being `qc_staff`, and asserts
that `qc_staff` reaches `/internal` and `/internal/quality` while every other
internal route is refused with a reason and a way back. All ten pass.

`ui:lifecycle` grew from five flows to eleven. The run that closed this milestone
placed order `f536bd3c` as a dealer, had a sales manager approve it, dispatch it
with a note, generate invoice `QSA-2026-000094`, and take payment in full by
UPI with a typed reference — then asserted the ledger, the allocation row, the
51-unit stock reduction, and that dealer exposure returned to `90777.5` exactly.
It then recorded a QC verdict through the browser and proved it moved no
production quantity, round-tripped the ageing grace period to 7 and back to 0,
raised purchase order `PO-2026-000123` for 5 units at 250, and received batch
`E2E-1790505431331` with quantity 7.00 and an expiry of 27 March 2027.

Row counts moved by exactly what was created, and nothing else: orders 44 → 45,
invoices 36 → 37, payments 35 → 36. `scripts/e2e-cleanup.mjs` deliberately
refuses an invoiced order, so this residue stays on the development database
until the ledger is unwound by hand. That is the intended behaviour of the
cleanup script, not a leak.

---

## A documentation claim that was false

`README.md` and `docs/TALLY_EXPORT.md` both said no Tally exporter had been
written. One has existed since the initial import:
`web/src/app/api/tally/export/route.ts`, a finance-and-admin-only
`GET /api/tally/export` that pages both views, filters the period itself,
neutralises formula-like cells, returns a `sha256` checksum header, and records
every file through `public.record_tally_export`.

Checked against the running app today rather than trusted:

```
finance  status=200  text/csv  64 data rows  checksum 77f5bca2...
dealer   status=403  {"error":"Finance access required."}
admin    status=200  text/csv  64 data rows  checksum 77f5bca2...
tally_exports: two new csv rows, row_count 64, matching checksums
```

Both documents now say this, and both still record the real limitation: the
exporter writes CSV only, Tally numbers its own vouchers, and no file has ever
been loaded into a Tally installation.

---

## What this milestone does not prove

- **No Tally round trip.** The CSV is generated, checksummed and audited. It has
  never been imported into Tally, so none of the seven open mapping decisions is
  validated.
- **No server has been deployed.** The PM2, Nginx and deploy script are written
  and reviewed but have never run anywhere but this machine.
- **The lifecycle test proves the happy path.** It does not exercise a failed
  save, a lost session mid-flow, a slow network, or two users acting on the same
  order at once.
- **The UI coverage is Chromium only, and one viewport.** No Firefox, no WebKit,
  no mobile width.
- **Browser suites are not in CI.** They need live credentials and mutate data.
- **Privileges still are not visible in the schema the way a per-role grant
  would be.** Every control in these three migrations is a trigger or a policy
  because `authenticated` is a single role for all application users, so a
  reviewer has to read the trigger bodies to know what a role can do.

---

## State at completion

| Measure | Value |
| --- | --- |
| Migration files | 38 |
| Applied to live | 38 of 38 |
| Fresh-install checks | 41 of 41 |
| pgTAP suites | 6 of 6 (222 assertions) |
| stage11 assertions | 157, up from 113 |
| Restore checks | 31 of 31, across 42 foreign keys |
| Roles in `ui:smoke` | 10 of 10 |
| Flows in `ui:lifecycle` | 11 of 11 |
| Backups written and proven restorable | 2 |
| Dealer exposure | 90777.50, unchanged |
| Defects found and fixed | 1 real (12 unreachable write policies), 1 escalation closed (writable `sales_rep_id`), 1 false doc claim |
| Uncommitted files | 32 entries |

---

## Notes carried forward

- A row level security policy is not a permission. Every write path in this
  schema needs both a grant and a policy, and until the browser suites ran, the
  only evidence that any of them worked was a test that reset to the owner role
  — which bypasses the very thing under test.
- A test that resets to the owner role is not a permissions test. It is the one
  pattern in this suite that has now produced three wrong conclusions in a row:
  the unreachable `dealers` policies, the `42501` assertions on
  `production_runs` and dealer region, and the `sales_rep_id` intent comment.
  Future access-control tests should stay on `authenticated`.
- The lifecycle suite mutates the development database and cannot clean up after
  an invoiced order. Budget for a manual unwind, or run it against a scratch
  database.

## Next milestone

Carried forward from report 004, now the only things left:

- answer the seven Tally mapping questions and reconcile a real round trip
- provision a server and run `deploy.sh` as a rehearsal
- decide whether the demo accounts and shared password are replaced before any
  real traffic
