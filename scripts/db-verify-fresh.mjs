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
  users: 13,
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
