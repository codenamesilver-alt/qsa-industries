// Proves the repository can rebuild itself from nothing.
//
//   npm run db:verify-fresh
//   npm run db:verify-fresh -- --keep          leave the scratch database behind
//   npm run db:verify-fresh -- --db my_scratch
//
// Creates a throwaway database on the target server, replays every migration in
// order against an empty schema, asserts the demo dataset came out right, and
// runs the pgTAP suites against the result. The scratch database is dropped
// afterwards unless --keep is passed.
//
// This exists because a database that was migrated by hand can drift from the
// repository without anything noticing: a migration can be edited after it was
// applied, or depend on rows that only exist because somebody created them by
// hand. Both of those happened here, and neither was visible from the live
// database, which looked perfectly healthy the whole time.
import {
  applyMigration,
  bootstrapPlatform,
  connect,
  describeMigrationError,
  ensureMigrationsTable,
  listMigrations,
  runTests,
} from "./lib/db.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const dbFlag = args.indexOf("--db");

if (dbFlag !== -1 && typeof args[dbFlag + 1] !== "string") {
  console.error("--db needs a database name");
  process.exit(2);
}

const SCRATCH = dbFlag === -1 ? "qsadb_fresh_check" : args[dbFlag + 1];

// The name is interpolated into CREATE/DROP DATABASE, which cannot take a bound
// parameter, so it has to be a plain identifier before it is used.
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(SCRATCH)) {
  console.error(
    `invalid scratch database name: ${JSON.stringify(SCRATCH)}\n` +
      "Use 1-63 lowercase letters, digits, and underscores, starting with a letter or underscore.",
  );
  process.exit(2);
}

const GREEN_VALLEY = "20000000-0000-4000-8000-000000000001";

// The demo dataset's expected shape after every migration has run. Change the
// seed and these are the numbers that should change with it.
const EXPECTED = {
  orderStatus: { pending: 3, approved: 5, invoiced: 12, rejected: 1 },
  orders: 21,
  invoices: 12,
  firstInvoice: "QSA-2026-000001",
  lastInvoice: "QSA-2026-000012",
  invoiceSequence: 12,
  // 14 as of 20260926093200, which added the qc_staff demo account.
  users: 14,
  tallyExports: 3,
  greenValleyHeadroom: 57150,
  // QSA-LAYER-01 has to sit in this band: the dispatch suites place a 1000 unit
  // order and remove 200 before approving, so the stock guard only fires inside it.
  layerFeedStock: 1100,
  // The corrective migration must not touch this one. It used to select "oldest
  // approved order" and shipped this order on a fresh install.
  broilerFeedStock: 1780,
};

const BUSINESS_TABLES = [
  "dealers",
  "products",
  "price_lists",
  "stock_levels",
  "stock_movements",
  "production_runs",
  "production_run_materials",
  "orders",
  "order_items",
  "order_events",
  "order_approvals",
  "invoices",
  "payments",
  "payment_allocations",
  "tally_exports",
  "users",
  "user_hierarchy",
  "finance_settings",
];

const CHECKS = [
  ["orders total", "select count(*)::int v from orders", EXPECTED.orders],
  ...Object.entries(EXPECTED.orderStatus).map(
    ([status, count]) =>
      [
        `orders ${status}`,
        `select count(*)::int v from orders where status = '${status}'`,
        count,
      ],
  ),
  ["invoices", "select count(*)::int v from invoices", EXPECTED.invoices],
  ["users", "select count(*)::int v from users", EXPECTED.users],
  ["tally_exports", "select count(*)::int v from tally_exports", EXPECTED.tallyExports],
  [
    "invoice sequence realigned",
    "select last_value::int v from public.invoice_number_seq",
    EXPECTED.invoiceSequence,
  ],
  ["first invoice number", "select min(invoice_number) v from invoices", EXPECTED.firstInvoice],
  ["last invoice number", "select max(invoice_number) v from invoices", EXPECTED.lastInvoice],
  [
    "LAYER-01 stock in the dispatch band",
    `select current_quantity::int v from stock_levels sl
       join products p on p.id = sl.product_id where p.sku = 'QSA-LAYER-01'`,
    EXPECTED.layerFeedStock,
  ],
  [
    "BROILER-01 stock untouched by the corrective migration",
    `select current_quantity::int v from stock_levels sl
       join products p on p.id = sl.product_id where p.sku = 'QSA-BROILER-01'`,
    EXPECTED.broilerFeedStock,
  ],
  [
    // stock_movements_apply_level keeps every level a pure function of the
    // ledger, so a fresh install that cannot reconcile is a broken install, not
    // a cosmetic drift. This is the same check db:audit prints.
    "every stock level reconciles with its ledger",
    `select count(*)::int v
       from (
         select p.id,
                coalesce(sl.current_quantity, 0) - coalesce(mv.movement_sum, 0) as gap
         from products p
         left join stock_levels sl on sl.product_id = p.id
         left join lateral (
           select sum(case m.movement_type when 'in' then m.quantity else -m.quantity end) as movement_sum
           from stock_movements m where m.product_id = p.id
         ) mv on true
       ) gaps
      where gap <> 0`,
    0,
  ],
  [
    "Green Valley has credit headroom",
    `select round((coalesce(credit_limit_override, credit_limit)
       - private.order_exposure(id))::numeric, 2)::int v
     from dealers where id = '${GREEN_VALLEY}'`,
    EXPECTED.greenValleyHeadroom,
  ],
  [
    "Green Valley keeps its remaining approved order",
    `select count(*)::int v
       from orders o
       join order_items oi on oi.order_id = o.id
       join products p on p.id = oi.product_id
      where o.dealer_id = '${GREEN_VALLEY}'
        and o.status = 'approved'
        and p.sku = 'QSA-BROILER-01'
        and oi.quantity = 1500`,
    1,
  ],
  [
    "the settlement order is invoiced",
    `select count(*)::int v
       from orders o
       join order_items oi on oi.order_id = o.id
       join products p on p.id = oi.product_id
      where o.dealer_id = '${GREEN_VALLEY}'
        and p.sku = 'QSA-LAYER-01'
        and oi.quantity = 1800
        and o.status = 'invoiced'`,
    1,
  ],
  [
    "no invoice beyond the seeded range",
    "select count(*)::int v from invoices where invoice_number > 'QSA-2026-000012'",
    0,
  ],

  // -------------------------------------------------------------------------
  // Schema presence checks for the 20260926 migration block. These exist so a
  // migration that silently fails to create something is caught here rather
  // than by a screen that cannot load three weeks later.
  // -------------------------------------------------------------------------
  [
    "every product carries a tax code",
    "select count(*)::int v from products where hsn_code is null or btrim(hsn_code) = ''",
    0,
  ],
  [
    "every invoice has at least one line",
    `select count(*)::int v from invoices i
       where not exists (select 1 from invoice_lines il where il.invoice_id = i.id)`,
    0,
  ],
  [
    "every invoice line carries a tax code",
    "select count(*)::int v from invoice_lines where hsn_code is null or btrim(hsn_code) = ''",
    0,
  ],
  [
    "invoice headers reconcile with their lines",
    `select count(*)::int v from invoices i
       where abs(i.taxable_amount - coalesce((select sum(l.taxable_amount) from invoice_lines l
                                              where l.invoice_id = i.id), 0)) > 0.01
          or abs(i.total_amount - coalesce((select sum(l.line_total) from invoice_lines l
                                            where l.invoice_id = i.id), 0)) > 0.01
          or abs(i.gst_amount - coalesce((select sum(l.cgst_amount + l.sgst_amount + l.igst_amount)
                                            from invoice_lines l where l.invoice_id = i.id), 0)) > 0.01`,
    0,
  ],
  [
    "qc_staff exists in the user role enum",
    `select count(*)::int v from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = 'user_role' and e.enumlabel = 'qc_staff'`,
    1,
  ],
  [
    "a qc_staff demo account exists",
    "select count(*)::int v from users where role = 'qc_staff'",
    1,
  ],
  [
    "every seeded dealer has a region",
    "select count(*)::int v from dealers where region is null or btrim(region) = ''",
    0,
  ],
  [
    "the region report exists",
    "select count(*)::int v from information_schema.views where table_schema = 'public' and table_name = 'sales_by_region'",
    1,
  ],
  [
    "no dealer falls through to Unassigned",
    "select count(*)::int v from sales_by_region where region = 'Unassigned'",
    0,
  ],
  [
    "ageing settings columns exist",
    `select count(*)::int v from information_schema.columns
       where table_schema = 'public' and table_name = 'finance_settings'
         and column_name in ('ageing_grace_days', 'ageing_bucket_1_days',
                             'ageing_bucket_2_days', 'ageing_bucket_3_days',
                             'credit_counts_current_invoices')`,
    5,
  ],
  [
    "the invoice ageing view exists",
    "select count(*)::int v from information_schema.views where table_schema = 'public' and table_name = 'dealer_invoice_ageing'",
    1,
  ],
  [
    "the expiry batch view exists",
    "select count(*)::int v from information_schema.views where table_schema = 'public' and table_name = 'expiring_batches'",
    1,
  ],
  [
    "the dealer catalog exposes a sellable quantity",
    `select count(*)::int v from information_schema.columns
       where table_schema = 'public' and table_name = 'dealer_catalog'
         and column_name = 'sellable_quantity'`,
    1,
  ],
  [
    "stock movements can reference a batch",
    `select count(*)::int v from information_schema.columns
       where table_schema = 'public' and table_name = 'stock_movements'
         and column_name = 'batch_id'`,
    1,
  ],
  [
    "purchase orders start empty",
    "select count(*)::int v from purchase_orders",
    0,
  ],
  [
    "batches start empty",
    "select count(*)::int v from product_batches",
    0,
  ],
  [
    // Batch tracking must stay optional: on a fresh install nothing is batch
    // tracked, so dispatch has to work against the product-level ledger alone.
    "no product is batch tracked on a fresh install",
    `select count(*)::int v from products p
       where exists (select 1 from product_batches b where b.product_id = p.id)`,
    0,
  ],
];

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}

const admin = await connect();
let scratch;

try {
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  console.log(`created scratch database ${SCRATCH} on ${admin.host}\n`);
} catch (error) {
  console.error(`could not create ${SCRATCH}: ${error.message}`);
  console.error("The target server must allow the connecting role to create databases.");
  await admin.end();
  process.exit(2);
}
await admin.end();

const client = await connect({ database: SCRATCH });

try {
  await client.connect();
  await ensureMigrationsTable(client);
  await bootstrapPlatform(client);

  const migrations = listMigrations();
  console.log(`replaying ${migrations.length} migrations\n`);

  for (const migration of migrations) {
    const started = Date.now();
    try {
      await applyMigration(client, migration);
      console.log(`OK    ${migration.file}  (${Date.now() - started}ms)`);
    } catch (error) {
      console.log(`FAIL  ${migration.file}`);
      console.log(describeMigrationError(error));
      console.log(
        `\nA migration failed on an empty database. Either the SQL is wrong or it` +
          ` depends on something the repository does not create.`,
      );
      process.exitCode = 1;
      throw new Error("migration replay failed");
    }
  }

  const recorded = await client.query("select count(*)::int n from supabase_migrations.schema_migrations");
  record(
    `all ${migrations.length} migrations recorded`,
    recorded.rows[0].n === migrations.length,
    `recorded ${recorded.rows[0].n}`,
  );

  // The history table is the only record of what ran, so an incomplete row is a
  // silent trap: versions are present, so the table looks healthy, but there is
  // no SQL behind 16 of them. Check the shape and the contents together.
  const historyShape = await client.query(
    `select
       (select array_agg(column_name order by ordinal_position)
          from information_schema.columns
         where table_schema = 'supabase_migrations' and table_name = 'schema_migrations') as cols,
       (select count(*)::int from supabase_migrations.schema_migrations
         where statements is null or cardinality(statements) = 0) as empty_statements,
       (select count(*)::int from supabase_migrations.schema_migrations
         where name is null or name like '%.sql' or name ~ '^[0-9]{14}') as bad_names`,
  );
  const h = historyShape.rows[0];
  // node-postgres hands back a text[] as its literal `{a,b}` string, so compare
  // the rendered form rather than assuming a parsed array.
  const columns = String(h.cols).replace(/[{}]/g, "").split(",").filter(Boolean);
  record(
    "history table has the CLI's three columns",
    columns.join(",") === "version,statements,name",
    `columns: ${h.cols}`,
  );
  record(
    "every history row records its SQL",
    h.empty_statements === 0,
    `${h.empty_statements} row(s) with no statements`,
  );
  record(
    "every history row uses the CLI name convention",
    h.bad_names === 0,
    `${h.bad_names} row(s) named like a filename`,
  );

  console.log("\n--- dataset assertions ---");
  for (const [label, sql, expected] of CHECKS) {
    const { rows } = await client.query(sql);
    const actual = rows[0].v;
    record(label, actual === expected, `expected ${expected}, got ${actual}`);
  }

  const empty = [];
  for (const table of BUSINESS_TABLES) {
    const { rows } = await client.query(`select count(*)::int v from public.${table}`);
    if (rows[0].v === 0) empty.push(table);
  }
  record(
    `all ${BUSINESS_TABLES.length} business tables populated`,
    empty.length === 0,
    empty.length ? `empty: ${empty.join(", ")}` : "",
  );

  console.log("\n--- pgTAP against the fresh install ---");
  const { suites, failed } = await runTests(client);
  record(`pgTAP suites (${suites - failed}/${suites})`, failed === 0);
} catch (error) {
  if (error.message !== "migration replay failed") {
    console.error(`\nverification aborted: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();

  const cleanup = await connect();
  try {
    await cleanup.connect();
    if (keep) {
      console.log(`\n--keep: left ${SCRATCH} in place for inspection`);
    } else {
      await cleanup.query(`drop database if exists ${SCRATCH} with (force)`);
      console.log(`\ndropped scratch database ${SCRATCH}`);
    }
  } finally {
    await cleanup.end();
  }
}

const failedChecks = results.filter((result) => !result.ok);
console.log(
  failedChecks.length
    ? `\n${failedChecks.length} of ${results.length} checks FAILED -- a fresh install does not match the repository`
    : `\nall ${results.length} fresh install checks passed`,
);
process.exitCode = failedChecks.length ? 1 : (process.exitCode ?? 0);
