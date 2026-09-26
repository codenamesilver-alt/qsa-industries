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
| `scripts/` | Database migration, test, audit and cleanup tooling, plus the browser tests |
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
npm run db:history-backfill  # repair incomplete migration-history rows
npm run db:migration-redo    # re-apply one already-applied migration from its file
npm run db:audit             # read-only snapshot of dealer exposure, stock and counts
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
of the nine roles it signs in through the actual login form, walks the routes that
role is allowed to see, and asserts the page rendered real data, then checks the
routes that role must be refused. It fails on console errors, uncaught page
errors, failed requests, and any page that comes back thin or showing an error
boundary.

Two details it exists to catch:

- **Status codes are not enough.** A role that is refused a page used to be
  redirected to the public marketing homepage, which answered `200` and looked
  fine to any status-only check while reading as "you are signed out". The script
  asserts page content and the redirect target, not just the status.
- **The allowed/denied lists must track the code.** `ACCOUNTS` in the script
  mirrors the `requireProfile` role lists in `web/src/app`. If a page's role list
  changes, update the script or the coverage is silently wrong.

Screenshots of every visited page land in `.smoke/` (gitignored) for eyeballing
when something fails. `SMOKE_BASE_URL` and `SMOKE_SHOTS` override the defaults.

The demo password comes from `SMOKE_PASSWORD` so no credential is committed.
Run it against a local build, not production: it signs in nine times and mutates
nothing, but it is still a full authenticated crawl.

## Order lifecycle test

```bash
npm run build --prefix web
npm run start --prefix web -- -p 3100          # in another shell
SMOKE_PASSWORD=<demo password> npm run ui:lifecycle
E2E_QTY=211 SMOKE_PASSWORD=<demo password> npm run ui:lifecycle
```

`scripts/ui-lifecycle.mjs` walks one order through its whole life in a real
browser, as four different users, and checks the database after each step:
dealer submits, sales manager approves, logistics dispatches, finance generates
the invoice, finance records a full payment. It then asserts the invoice number,
GST split, payment allocation, ledger balance, stock movement, dealer exposure
back at its starting value, and the table counts.

**It creates real data and does not clean up after a successful run.** Each run
leaves one dispatched, invoiced and paid order. That is deliberate — an
invoiced order is an accounting fact, not a fixture — but it means the demo
dataset grows by one order per run, and `ui:lifecycle` is not part of `npm test`.

Two guards make repeat runs safe:

- **It refuses to start on an ambiguous amount.** The database read is read-only,
  but if an existing order for that dealer already totals the same value, the
  script would not know which panel it is looking at, so it stops and asks for a
  different `E2E_QTY`. The default is 137; 211 is the other one proven to work.
- **A partial run can be unwound.** `scripts/e2e-cleanup.mjs <order-id>` deletes
  an order left in `pending`, `approved` or `dispatched`, and restores the stock
  it moved — the insert-only trigger means the helper has to put the level back
  itself. It refuses `invoiced` and `rejected`, because reversing those is a real
  accounting reversal rather than a test cleanup.

Use `npm run db:audit` afterwards to see what a run left behind.

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

