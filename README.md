# QSA Industries ERP

Order-to-cash ERP for a poultry feed manufacturer: dealer orders, credit limits,
production and QC, inventory, dispatch, invoicing, payments, and Tally export.

The application is a Next.js app in [`web/`](web). The database is PostgreSQL on
Supabase, with all schema and seed data expressed as migrations in
[`supabase/migrations/`](supabase/migrations).

## Layout

| Path | What it is |
| --- | --- |
| `web/` | Next.js application (App Router) |
| `supabase/migrations/` | Schema, functions, RLS, and dev seed data, in order |
| `supabase/tests/` | pgTAP suites, one file per stage |
| `supabase/functions/` | Edge functions, the only code that holds the service role key |
| `scripts/` | Database migration, test, audit, backup and cleanup tooling, plus the browser tests |
| `deployment/` | PM2 process definition, Nginx config, and the deploy script |
| `docs/` | Build plan, Tally export mapping, and design notes |
| `backups/` | Logical database dumps (gitignored) |
| `.env` | Local database credentials (gitignored) |
| `.smoke/`, `.smoke-lifecycle/` | Browser-test screenshots (gitignored) |

## Database tooling

### Setup

```bash
npm install
cp .env.example .env    # then fill in the values
```

`.env` uses the standard libpq variable names. The scripts read it directly, so
there is no export step. Real environment variables always take precedence over
the file, so CI can inject secrets without a `.env`.

Use the **session pooler** connection string, not the transaction pooler:
`db:verify-fresh` opens a connection and then switches to another database on the
same server, which the transaction pooler does not allow.

### Commands

```bash
npm run db:migrate           # apply pending migrations, record them
npm run db:test              # run the pgTAP suites against the target database
npm run db:verify-fresh      # prove a from-scratch install matches the repository
npm run db:backup            # write a logical dump of every public table
npm run db:restore-check     # prove the newest backup actually restores
npm run db:history-backfill  # repair incomplete migration-history rows
npm run db:migration-redo    # re-apply one already-applied migration from its file
npm run db:audit             # read-only snapshot of dealer exposure, stock and counts
npm run db:mutation-hsn      # prove an HSN code change is rejected or accepted correctly
npm test                     # db:test, then db:verify-fresh
```

`db:verify-fresh` is the important one. It creates a scratch database, replays
every migration from zero, asserts the demo dataset landed correctly, runs the
pgTAP suites against that fresh install, then drops the database. It catches the
class of bug where the live database is fine but a new environment is not.

Options:

```bash
npm run db:verify-fresh -- --keep     # leave the scratch database for inspection
npm run db:verify-fresh -- --db name  # use a specific scratch database name
```

`--db` needs `CREATEDB` rights, which the Supabase `postgres` role has. The script
never touches the target database in `.env`; it only creates and drops its own
scratch database.

### Migration history

History lives in `supabase_migrations.schema_migrations`, created with the same
three columns the Supabase CLI creates for itself (`version`, `statements`,
`name`). `name` is the CLI's convention: the filename with the leading 14-digit
version and the `.sql` extension removed, so
`20260925081840_day1_schema_foundation.sql` is stored as `day1_schema_foundation`.

`db:verify-fresh` asserts all three of those properties on every run, because a
row can be quietly wrong in a way that still looks healthy: versions present, no
SQL behind them. Older rows written by earlier revisions of this runner recorded
`statements` as NULL and the full filename in `name`. `db:history-backfill`
rewrites them from the files in this repository, so it is idempotent and safe to
re-run. It touches the history table only.

**Do not use `supabase db reset` on this project.** The CLI splits a migration
into individual statements and replays the stored `statements`; this runner
sends each file as one multi-statement query and records the file as a single
element. A reset would find 21 recorded versions and replay almost no SQL. Use
`npm run db:verify-fresh`, which replays the files themselves, and treat the CLI
as unavailable for this database. Two of the live rows were originally applied by
the CLI, which is why the table shape and naming are pinned to match it.

### Correcting a migration you already applied

While a migration is still in development, editing its file leaves the database
and the repository disagreeing. `db:migration-redo` resolves that by dropping the
history row and replaying the file:

```bash
npm run db:migration-redo -- 20260925092500
```

It refuses if the version is not recorded (use `db:migrate` for that) and refuses
if any later migration is recorded on top of it, since those were applied against
a schema that is about to change; `--force` overrides that second guard. This is
the controlled equivalent of `supabase migration repair` plus a re-apply, which is
unavailable here for the reason above.

Never use it on a migration that has been deployed anywhere real. Correcting
deployed history means a new forward migration, not a rewrite.

## Reading live state

`npm run db:audit` is read-only — every statement in it is a `SELECT`. It prints
the exposure breakdown for one dealer, orders grouped by status, the most recent
orders, the rows the lifecycle test created, every product's stock level against
its own movement ledger, and the table counts. Use it to explain a number rather
than guess at it. Two details it exists to make legible:

- **Exposure drops when an order is dispatched, and that is correct.**
  `private.order_exposure` counts only `pending`, `pending_director_approval` and
  `approved`. A move to `dispatched` takes the order out of the exposure figure
  while no invoice exists yet, so exposure can fall by a full order total with no
  money changing hands. The breakdown in the audit output is what distinguishes
  that from real drift.
- **Every stock level must equal the signed sum of its movements.**
  `stock_movements_apply_level` is `AFTER INSERT OR UPDATE OR DELETE`, so an
  insert applies a movement's effect, a delete applies its negation, and an edit
  applies the difference. The level is therefore a pure function of the ledger
  and cannot drift from it. An update that only rewrites bookkeeping columns such
  as `created_at` nets to zero and leaves stock alone, which is what lets the
  backdated demo timeline replay from scratch.

  The ledger is deliberately *not* append-only. Whether an ERP should permit
  history edits at all is a policy decision; what the trigger rules out is a
  silent desync that looks self-healing. Enforcing immutability on `created_at`
  would break `20260925092200` and `20260925092400`, which rewrite movement
  timestamps to build the demo timeline.

  Opening stock is recorded as movements with
  `source = 'opening_balance'`, dated before the product's first movement. The
  seed migrations used to set `stock_levels` to hand-picked numbers and write a
  history around them, which left eight of eleven products unable to explain
  their own balance — LAYER-01 carried 1100 against a movement total of -100.
  `20260925092700` records the difference, changing no level, so the demo figures
  are untouched and finally auditable.

  `db:audit` prints the comparison for every product and `db:verify-fresh` asserts
  it on a fresh install, so a regression fails a test rather than waiting to be
  noticed in a number.

### Writing tests

`supabase/tests/*.sql` are pgTAP suites. Each one is a self-contained transaction
that ends in `select * from finish(); rollback;`, so nothing leaks between suites
even though they all run against the same live database.

**Assert deltas, not seed values.** The dev demo dataset in
`20260925092200_dev_demo_dataset.sql` deliberately moves stock levels, dealer
counts, and invoice totals away from the day-one values, so a test that asserts
`current_quantity = 1200` will fail against the demo dataset even though the code
under test is correct. Capture what you need at the top of the suite, while the
session is still the table owner, then assert the change:

```sql
create temporary table inventory_baseline as
select current_quantity as qty
from public.stock_levels
where product_id = '...';

-- later
select is(
  (select current_quantity from public.stock_levels where product_id = '...'),
  (select qty - 10 from inventory_baseline),
  'dispatch reduces finished-goods stock'
);
```

Create the fixture table *before* `set local role authenticated` and grant it, or
after and rely on the `TEMP` privilege every role has by default. Reading a temp
table created by another role needs an explicit grant.

Keep `plan(n)` equal to the number of assertions. A mismatch is reported, and
means a test is not running the number of checks you think it is.

`service_role` has `BYPASSRLS` but is not granted `SELECT` on every table, so
prefer capturing reference counts as the table owner over switching to
`service_role` inside a test.

**Access-control tests stay on `authenticated`.** Never `set local role` to the
owner or to `service_role` in a suite that is testing what a signed-in user may
do. The owner role has `BYPASSRLS` and `service_role` is granted past every
policy, so both can make an unreachable code path look reachable. This is the one
pattern in this suite that has produced several wrong conclusions in a row — the
unreachable `dealers` policies, `42501` assertions on `production_runs` and dealer
region, and a writable `sales_rep_id` all passed against a role that no user
holds.

**Assert the refusal and the success separately.** For a write function with both
a role check and a state check, call it as a role that should be refused and
assert the error, then call it as the permitted role and assert the write. A
caller refused for the wrong reason must not be able to learn anything about the
row, and a suite that only checks the happy path cannot tell which check fired.

## Web app

```bash
cd web
npm install
npm run dev
npm run build
npm run lint
npm run typecheck
```

The app needs two public values, `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; any placeholder pair is enough to build.
`web/scripts/provision-user.mjs` (`npm run provision:user -- email full_name role
[dealer_id]`) creates an account and its profile, and needs a service-role key
plus `PROVISION_USER_PASSWORD` in the environment. It rejects an unknown role, a
dealer account with no `dealer_id`, and a `dealer_id` that does not exist, and it
deletes the auth user again if the profile write fails.

## Browser smoke test

```bash
npm run build --prefix web
npm run start --prefix web -- -p 3100   # in another shell
SMOKE_PASSWORD=<demo password> npm run ui:smoke
```

`scripts/ui-smoke.mjs` drives a real Chromium through all three portals. For each
of the ten roles it signs in through the actual login form, walks the routes that
role is allowed to see, and asserts the page rendered real data, then checks the
routes that role must be refused. It fails on console errors, uncaught page
errors, failed requests, and any page that comes back thin or showing an error
boundary. Every route appears in some role's allowed or denied list, and a route
that the code permits but the script never visits is itself a gap.

Two details it exists to catch:

- **Status codes are not enough.** A role that is refused a page used to be
  redirected to the public marketing homepage, which answered `200` and looked
  fine to any status-only check while reading as "you are signed out". The script
  asserts page content and the redirect target, not just the status.
- **The allowed/denied lists must track the code.** `ACCOUNTS` in the script
  mirrors the `requireProfile` role lists in `web/src/app`. If a page's role list
  changes, update the script or the coverage is silently wrong.
- **A denial is asserted three ways.** The route must land on `/unauthorized`, must
  say the route is outside the role, and must offer a way back. A redirect that
  lands somewhere plausible without explaining itself is still a broken gate.

Screenshots of every visited page land in `.smoke/` (gitignored) for eyeballing
when something fails. `SMOKE_BASE_URL` and `SMOKE_SHOTS` override the defaults.

The demo password comes from `SMOKE_PASSWORD` so no credential is committed.
Run it against a local build, not production: it signs in ten times and mutates
nothing, but it is still a full authenticated crawl.

## Order lifecycle test

```bash
npm run build --prefix web
npm run start --prefix web -- -p 3100          # in another shell
SMOKE_PASSWORD=<demo password> npm run ui:lifecycle
E2E_QTY=211 SMOKE_PASSWORD=<demo password> npm run ui:lifecycle
```

`scripts/ui-lifecycle.mjs` drives thirteen write paths in a real browser, as ten
different users across the three portals, and checks the database after each one.
The first five are one order through its whole life: dealer submits, sales manager
approves, logistics dispatches, finance generates the invoice, finance records a
full payment. The run then asserts the invoice number, GST split, payment
allocation, ledger balance, stock movement, dealer exposure back at its starting
value, and the table counts. The remaining eight are separate write paths:
a QC verdict, a finance grace-days setting, a raised purchase order, a received
batch, a sales rep's proxy order for a mapped dealer, a credit-limit edit by
finance, a product and dealer price created through the admin screen, and a
delivery confirmation against the consignment from step 3.

The last flow asserts the delivery note, the timestamp, the new `delivery_status`
and that `public.order_status` is still `invoiced`. Consignment state and order
state are separate columns on purpose: an order can be paid for while the goods are
still on the road.

**It creates real data and does not clean up after a successful run.** Each run
leaves one dispatched, invoiced and paid order, plus the purchase order, batch and
QC record it made. That is deliberate — an invoiced order is an accounting fact,
not a fixture — but it means the demo dataset grows on every run, and
`ui:lifecycle` is not part of `npm test`.

Three of the eight extra flows do tidy up after themselves, because they would
otherwise accumulate: the proxy order is deleted, the dealer's credit limit is put
back to its pre-step value, and the product and dealer price created on the admin
screen are removed once both writes are read back. No order references that SKU,
so the delete cannot reach a document line.

Three guards make repeat runs safe:

- **It refuses to start on an ambiguous amount.** The database read is read-only,
  but if an existing order for that dealer already totals the same value, the
  script would not know which panel it is looking at, so it stops and asks for a
  different `E2E_QTY`. The default is 137; 211 is the other one proven to work.
- **A partial run can be unwound.** `scripts/e2e-cleanup.mjs <order-id>` deletes
  an order left in `pending`, `approved` or `dispatched`, and restores the stock
  it moved — the insert-only trigger means the helper has to put the level back
  itself. It refuses `invoiced` and `rejected`, because reversing those is a real
  accounting reversal rather than a test cleanup.
- **Every read-back names the row it checked.** Where a step creates a record and
  then finds it again through a UI, the assertion names the dealer, product or
  order it looked up. Two earlier checks passed while comparing the wrong rows,
  and a locator that matched more than one form is exactly how that happens.

Use `npm run db:audit` afterwards to see what a run left behind.

## Admin and delivery

`/internal/admin` and `/internal/delivery`, both gated the same way as the rest of
the internal portal: admin alone for `/internal/admin`, admin and logistics for
`/internal/delivery`.

Products, dealers, users and prices have no direct browser write path, because
`authenticated` holds `SELECT` and nothing else on those tables. Admin writes go
through `SECURITY DEFINER` functions — `create_product`, `update_product`,
`create_dealer`, `update_dealer`, `update_user_access`, `set_dealer_price` — each
of which checks the caller's role itself. `user_directory` is a view over
`public.users` and `public.auth.users` for the same reason: `public.users` has no
email column, and a function that exposes `auth.users` to everyone would hand out
every account in the project.

Consignment state lives in `delivery_status` on `orders`, not in
`public.order_status`, and the two are never merged. `dispatch_order` sets both;
`mark_order_delivered` sets only the delivery columns. A paid order whose goods are
still on the road is the normal case, not a contradiction.

The delivery board is a `SECURITY DEFINER` view that reads `dealers` for the
caller, because `logistics` is deliberately not in `can_view_dealer` and adding it
there to satisfy one name column per order would widen dealer visibility across
the whole schema.

`price_lists_select_scope` hides future-dated rows, so a price scheduled for next
month is invisible on the admin screen while the catalogue still computes against
it. That is inherited from the 20260926 schema and is a real gap in the admin
view.

## Dealer onboarding

`/internal/admin/dealers`, admin only. A separate route from `/internal/admin`
because it answers a different question: not "what is true about this account now"
but "what is between this dealer and trading". The master page is long and mostly
catalogue; this is a short queue of five actions per dealer.

Creating a dealer here does not create a trading dealer.
`admin_start_dealer_onboarding` writes the dealer `inactive`, with
`credit_limit = 0` and no sales rep, and opens a `dealer_onboardings` record in the
same call. A requested limit is not a granted one, so it is recorded on the
onboarding record and copied onto `dealers.credit_limit` only by
`admin_activate_dealer`. That is the only path by which a newly onboarded dealer
gets a limit.

There is deliberately no `stage` column. `dealer_onboarding_board` derives the
stage from the recorded facts, so the answer cannot drift from the columns it was
computed from, and `outstanding` names what is still missing in the order the
flow runs. A dealer with no onboarding record is absent from the board, which
means "trading since before onboarding existed" and is read from the dealer
master instead.

Four refusals are load bearing and each has a reason in the migration:

- An **unmapped dealer cannot be activated.** `create_dealer_order` reads
  `dealers.sales_rep_id` into a `not null` `orders.sales_rep_id`, so an unmapped
  live account could never be ordered for, including from its own portal.
- **Credit refusal is not a closure.** A refusal is a decision about a number and
  leaves the record open for a different figure. `admin_decline_dealer_onboarding`
  is the separate act that finishes a record, and the two live in different
  columns for exactly that reason.
- **A request cannot be edited after a decision.** Otherwise an approved figure
  ends up attached to a request nobody saw. Re-deciding is the way back.
- **Claiming an unassigned dealer stays an admin act.** `can_view_dealer` is
  false for a null `sales_rep_id`, so an unowned dealer is invisible to every
  manager. A manager sees the count and asks for it; a manager does not take it.

Rep mapping has two writers with different scopes, and the difference is not an
oversight. `sales_assign_dealer_to_rep` is a manager moving a dealer between two
reps inside their own team, and it refuses a null target, because clearing a
mapping takes the dealer out of every manager's reach. `admin_map_dealer_to_rep`
is the admin path from the onboarding board, changes one column and nothing else,
and does allow null.

### The login edge function

`supabase/functions/provision-dealer-login` is the only code in the repository
that holds the service role key. It is needed because creating an `auth.users` row
goes through the Auth admin API, and that key must never reach a browser.

The function is not a security boundary and does not need to be. It reads the
caller's role from `public.users` and refuses a non-admin before writing anything,
and then calls `public.admin_link_dealer_login`, which is granted to `service_role`
alone and re-reads the caller id out of `public.users` and refuses again. A future
edit that removed the check in the edge runtime would still be refused by the
database.

Deploy it with exactly one secret, set as an edge function secret and never
committed:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>   # or set it in the dashboard
supabase functions deploy provision-dealer-login
```

Until it is deployed, `admin_activate_dealer` cannot be satisfied from the browser,
because its login precondition is only reachable through it.

## Continuous integration

`.github/workflows/ci.yml` runs two jobs on every push and pull request:

- **migrations and pgTAP** — a `postgres:17` service, pinned to the live project's
  major version, then the scripts' `node --check` and `npm test`. The fresh-install
  replay is the point: a migration that only works against the already-migrated
  live project fails here. `db:history-backfill` is deliberately absent — it
  repairs a live project's history, and this database is empty, so the table it
  queries does not exist yet. The history shape, recorded SQL and naming
  convention are asserted by `db:verify-fresh` during `npm test` instead, against
  a database actually built by replaying the migrations.
- **lint, typecheck and build** — the `web` app with placeholder public Supabase
  env values. No real credentials are needed or wanted; the two variables are
  inlined into the client bundle.

The browser suites are deliberately not in CI. `ui:smoke` and `ui:lifecycle`
drive a running Next.js server against a real Supabase project, so they need live
credentials and mutate data. Run them locally.

## Backups and restores

```bash
npm run db:backup                # write backups/qsa-<timestamp>.sql
npm run db:restore-check         # rebuild the newest backup and prove it works
```

`db:backup` writes a logical dump of every public table to `backups/`, named
`qsa-<UTC timestamp>.sql`, and prunes on every run: the newest 20 are kept, and
anything older than 14 days is dropped. The dump is **data only** — the schema
comes from `supabase/migrations`, so a restore replays the migrations and loads
the dump on top. That keeps the file small and diffable, and it means a dump is
only compatible with the migration set that produced it, so keep backups and
commits together.

Values are rendered by PostgreSQL itself, not by the script, so escaping is the
server's job. The dump ends with `setval` for every sequence, which is the part
that is easy to forget and expensive to discover later: without it, a restored
database hands out invoice numbers that already exist.

`db:restore-check` is the part that matters. A backup nobody has restored is a
hypothesis. It creates a throwaway database, replays all 49 migrations, truncates
the seeded rows, loads the dump in one transaction with
`session_replication_role = replica`, then checks 31 things and drops the
database:

- every table's row count against the manifest the dump recorded **when it was
  taken**, not against the live database, so a concurrent write cannot cause a
  false failure;
- every foreign key in the public schema, 42 of them, counted as actual orphan
  rows. Enforcement is switched off during the load because `orders` ↔ `invoices`
  and `users` ↔ `dealers` reference each other and neither constraint is
  deferrable, so this check is what proves the load was legitimate rather than
  assuming it;
- the stock ledger reconciliation, the invoice sequence sitting past the highest
  invoice issued, no duplicated invoice numbers, every invoice still having its
  lines;
- all eleven pgTAP suites, 523 assertions, against the restored copy.

Options:

```bash
npm run db:restore-check -- --file qsa-<timestamp>.sql   # check a specific backup
npm run db:restore-check -- --keep                       # leave the scratch database
npm run db:restore-check -- --restore-to qsadb_restored  # restore for real, and keep it
```

`--restore-to` is the same work with a different ending: it builds a named
database, verifies it with all 31 checks, and leaves it in place. It refuses to
replace an existing database without `--force`, and it does not report success
if any check failed. This is the incident-recovery path — see
[`deployment/README.md`](deployment/README.md#rollback).

Both scripts need permission to create databases, which the Supabase `postgres`
role has. `pg_dump` is not required, but on a server that has it, also take a
self-contained dump so a restore does not depend on the migration files.

## Deployment

[`deployment/`](deployment/) holds the PM2 process definition, the Nginx site
config, and `deploy.sh`. Full setup, rollback, backup scheduling, and monitoring
instructions are in [`deployment/README.md`](deployment/README.md).

```bash
./deployment/deploy.sh    # backup, prove it, pull, migrate, build, reload, health check
```

The script takes a backup and proves it restores *before* running any migration,
because a backup taken after a migration is worthless. It migrates before it
builds, which is the safe direction here: every migration in this repository is
additive, so old code tolerates the new schema but new code would not tolerate
the old one.

Nothing in `deployment/` has been run against a real server yet. No VPS has been
provisioned and no domain points at this app, so treat the first deploy as a
rehearsal.

## Accounts

There is no signup. Accounts are created out of band by an administrator:

```bash
cd web
npm run provision:user -- email full_name role [dealer_id]
```

It needs `PROVISION_USER_PASSWORD` and a service-role key in the environment.
It rejects an unknown role, a dealer account with no `dealer_id`, and a
`dealer_id` that does not exist, and it deletes the auth user again if the
profile write fails.

The seed data creates 14 demo accounts across the ten roles, sharing one
password. `scripts/ui-smoke.mjs` signs in as one account per role — the `ACCOUNTS`
list in that file is the authoritative list, and it is what the allowed/denied
route assertions are written against. See the seed migration for all 14
addresses. Replace them with real per-user credentials before production; see the
next section.

## Tally export

The database side is built: `public.tally_invoice_lines` and
`public.tally_payment_lines` produce export-shaped rows, and
`public.record_tally_export` writes an audit record of every export. The CSV
exporter exists at `GET /api/tally/export` — see
[`web/src/app/api/tally/export/route.ts`](web/src/app/api/tally/export/route.ts) —
restricted to finance and admin, and it records every file it writes. No file
has ever been loaded into Tally.

The Tally-side mapping — voucher types, ledger names, GST split, voucher
numbering, and the XML shape — is blocked on knowing which Tally version and
import format to target. [`docs/TALLY_EXPORT.md`](docs/TALLY_EXPORT.md) records
the column-by-column mapping and lists the seven open decisions.

That work is deliberately parked until final integration, when the Tally API is
available. The database side is complete and tested, so the remaining work is
mapping and verification, not design.

## Reporting

PRD §9.4 asks for "sales trends by dealer, rep, manager, region/period". That is
served by `/sales/reports`, from four views added in
`20260928100000_regional_sales_reporting.sql`:

| View | Grain | Used for |
| --- | --- | --- |
| `sales_by_region_period` | region × calendar month | the trend chart |
| `sales_by_region_period_totals` | region, all time | ranking regions |
| `sales_by_rep` | rep × region, rolled up one level to the manager | team reporting |
| `sales_by_dealer` | dealer, including dealers with no orders | the drill-down table |

Two definitions are load bearing, and the whole report depends on them:

- **realized** — orders that are approved, dispatched, or invoiced. Revenue the
  business has committed to and not walked back.
- **pipeline** — orders that are pending or pending-director. Live but
  uncommitted, which is also exactly what credit approval checks against.

These are never added together. A single "order value" column that sums every
status mixes rejected orders with delivered ones and produces a number that is
neither revenue nor risk, which is worse than having no number because it looks
authoritative. Rejected value is reported separately so approval quality is
visible.

All four views are `security_invoker`, so RLS runs as the calling user and a rep
sees only their own accounts while a manager sees their reports'. The scoping is
enforced in the database, not by filtering in the page, so the screen cannot leak
by forgetting a clause. A rep's pipeline total and the region's total are
deliberately allowed to differ.

Periods are calendar months in `Asia/Kolkata`, matching the convention
`sales_daily` already set. Grouping a `timestamptz` on UTC boundaries would split
the first of each month for anything booked after 05:30, which is most of a
working day here.

### Date ranges and export

The four views above are all-time aggregates, and a view cannot take a parameter.
A date range could not be applied to this report by filtering the views: three of
the four have already summed orders into one row per group, so a window cannot be
recovered from them afterwards. `20260928105000_sales_report_date_range.sql` adds
four functions that apply the range where the rows are still order level:

| Function | Replaces | For |
| --- | --- | --- |
| `sales_report_region_period` | `sales_by_region_period` | the trend chart |
| `sales_report_region_totals` | `sales_by_region_period_totals` | ranking regions |
| `sales_report_by_rep` | `sales_by_rep` | team reporting |
| `sales_report_by_dealer` | `sales_by_dealer` | the dealer book |

Each takes `p_from` and `p_to` as `date`, inclusive at both ends, and a null bound
is unbounded. So `(null, null)` is the all-time report, which is what the screen
showed before the range existed, and an empty date input means "no bound" rather
than being a default window. The range is expressed on the same
`created_at at time zone 'Asia/Kolkata'` date the month buckets use; filtering on
a UTC date would silently drop orders placed late on the last day of a window.

The views are **kept and still used**. The dashboard reads `sales_by_rep` and
`sales_by_dealer` for its charts, and the stage16 and stage17 suites assert the
view definitions directly, so replacing them would have put 68 test assertions and
the dashboard behind a change the export did not need. With a null range each
function returns exactly its view's rows, which `stage20` asserts against whatever
data is present, so the two paths cannot drift apart silently.

`open_invoices` and `outstanding_amount` are deliberately **not** bounded by the
range. An invoice balance is a point-in-time fact about money still owed, not a
flow inside a window; dating it to a period end would mean reconstructing each
invoice's balance as at that date from the payment allocation history, which is a
different question. The screen and the spreadsheet both label these two columns as
a current balance so no reader assumes all five money columns share one window.

An inverted range raises `22023` rather than returning nothing, because an inverted
range is the input most likely to produce an empty set and "no sales in that
period" is a dangerously plausible answer to a typo. The check is a `perform` in a
plpgsql body for the same reason: the first draft validated it in a `language sql`
body as a guard CTE cross joined to the query, which is silently skipped when the
visible set is empty — the exact case the check exists for.

### Exporting

- **`/api/reports/export?from=&to=`** returns a real `.xlsx`, five sheets: Summary,
  Regions, Reporting lines, Dealer book, Monthly trend. Money is written as numbers
  with a number format rather than pre-formatted strings, so the result can still
  be summed and pivoted. The same roles as the screen, and it reads through the
  same `security_invoker` functions, so the scoping is the database's decision.
- **Print / PDF** is the browser's own print dialog, with a print stylesheet in
  `web/src/app/globals.css`. There is deliberately no `/api/reports/pdf`: a second
  rendering of the report would be a second thing that can disagree with the
  first, and the browser can only print what is already correct on screen.

The range lives in the query string and is parsed by `web/src/lib/report-range.ts`,
shared by the screen and the export route, so a file always matches the page it was
taken from. The controls are a plain `GET` form rather than client state, which
makes the range bookmarkable and shareable and keeps the browser back button
honest. An unparseable range is reported, never silently widened: falling back to
all time would answer a question nobody asked with numbers that look right.

`.xlsx` needs no spreadsheet-injection guard, unlike the CSV export above, and the
reason is worth recording: CSV has no types so `=cmd|...` is a formula to Excel,
whereas a `.xlsx` string cell is written as a shared string with no formula part
and arrives as text. That was checked against the writer rather than assumed. The
protection lives in the file format rather than in this code, which matters if the
writer is ever swapped.

The workbook is built with `exceljs`, not the SheetJS package named `xlsx`. SheetJS
is frozen on npm at `0.18.5` with two high severity advisories and no fix
available there; its maintained builds are distributed from SheetJS's own CDN,
which is not something a CI job should pull. `exceljs` depends on `uuid` below
11.1.1, which carries a moderate advisory, so `web/package.json` pins
`overrides.uuid` to `^11.1.1` — npm's own suggested fix is to downgrade `exceljs`
to 3.4.0, which is older rather than newer. With the override `npm audit` reports
0 vulnerabilities, and `exceljs` 4.4.0 was verified to write and re-read a
workbook on `uuid` 11.1.1.

A dealer's region falls back `region` → `state` → `Unassigned`, with both values
`btrim`ed. A whitespace-only region counts as unset, because it would otherwise
become a group literally named with spaces, separate from the state it was meant
to fall back to.

The charts in [`web/src/components/charts.tsx`](web/src/components/charts.tsx) are
hand-rolled SVG rather than a charting dependency. Every number is already
aggregated by a view, so there is no dataset to fit or scale interactively, and
the components reuse the app's existing colour tokens so they cannot drift from
the rest of the UI. They are server components, so no client-side chart library is
pulled into the bundle.

## Before production

The dev database and the shared demo password are committed to the working
environment, not to version control. Rotate the database password, the service
role key, and the demo account passwords, and replace the shared demo password
with per-user credentials, before this goes anywhere near production.

`web/src/app/page.tsx` also carries static counts describing the demo dataset
(6 dealers, 11 products, 12 price lists, 13 team members). They cannot be read
live, because the homepage is public and RLS denies anonymous reads, so they have
to be updated by hand when the seed data changes. `db:verify-fresh` is what proves
those numbers.

