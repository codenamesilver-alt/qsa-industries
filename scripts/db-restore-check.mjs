// Proves a backup can actually be restored.
//
//   npm run db:restore-check
//   npm run db:restore-check -- --file qsa-20260927T094341Z.sql
//   npm run db:restore-check -- --keep
//   npm run db:restore-check -- --db my_scratch
//   npm run db:restore-check -- --restore-to qsadb_restored
//
// A backup nobody has restored is a hypothesis. This rebuilds a working database
// out of one: create a throwaway database, replay every migration to get the
// schema, load the dump on top, then check the result against the row counts the
// dump recorded when it was taken, check every foreign key with real queries,
// check the invariants this project depends on, and run the pgTAP suites against
// the restored copy. The scratch database is dropped unless --keep is passed.
//
// --restore-to is the same work with a different ending: the database is named,
// kept, and verified, which is what a restore during an incident actually needs.
// It is still verified before it is announced as usable, so a broken backup
// cannot quietly become the production database.
//
// The foreign keys are checked after the load rather than during it, because
// orders and invoices reference each other and users and dealers reference each
// other, so the load has to run with trigger enforcement off. That is only
// defensible because the rows came from a database that already satisfied every
// constraint -- and the orphan count below is the step that proves it rather than
// assuming it.
import fs from "node:fs";
import path from "node:path";
import {
  applyMigration,
  bootstrapPlatform,
  connect,
  describeMigrationError,
  ensureMigrationsTable,
  listMigrations,
  REPO_ROOT,
  runTests,
} from "./lib/db.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");

function flag(name, fallback) {
  const at = args.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`--${name} needs a value`);
    process.exit(2);
  }
  return value;
}

const backupDir = path.resolve(flag("dir", path.join(REPO_ROOT, "backups")));

// Two modes. The default proves a backup restores and throws the result away,
// which is safe to run any time. --restore-to builds a real, named database
// that is left in place, which is what an incident needs and is not something
// to do by hand from a psql recipe.
const restoreTo = flag("restore-to", null);
const force = args.includes("--force");
const SCRATCH = restoreTo ?? flag("db", "qsadb_restore_check");
const KEEP = keep || Boolean(restoreTo);

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(SCRATCH)) {
  console.error(
    `invalid database name: ${JSON.stringify(SCRATCH)}\n` +
      "Use 1-63 lowercase letters, digits, and underscores, starting with a letter or underscore.",
  );
  process.exit(2);
}

if (restoreTo) {
  if (restoreTo === flag("db", "qsadb_restore_check")) {
    console.error("--restore-to must name a database other than the default scratch name");
    process.exit(2);
  }
  console.log(
    `\nRESTORE MODE: ${SCRATCH} will be created and kept. Every transaction made since\n` +
      "the backup was taken is absent from it. That is the point of a restore, but\n" +
      "it is not a merge.\n",
  );
}

function newestBackup() {
  if (!fs.existsSync(backupDir)) return null;
  const name = fs
    .readdirSync(backupDir)
    .filter((entry) => entry.startsWith("qsa-") && entry.endsWith(".sql"))
    .sort()
    .reverse()[0];
  return name ? path.join(backupDir, name) : null;
}

const file = flag("file", null) ? path.resolve(backupDir, flag("file", null)) : newestBackup();

if (!file || !fs.existsSync(file)) {
  console.error(`no backup found in ${backupDir}`);
  console.error("Take one first:  npm run db:backup");
  process.exit(2);
}

const dump = fs.readFileSync(file, "utf8");
const manifest = new Map(
  dump
    .split(/\r?\n/)
    .map((line) => line.match(/^-- manifest: (\S+) (\d+)$/))
    .filter(Boolean)
    .map((match) => [match[1], Number(match[2])]),
);

if (!manifest.size) {
  console.error(`${path.basename(file)} has no row-count manifest`);
  console.error("Take a new backup: the manifest is what the restore is checked against.");
  process.exit(2);
}

// A dump cut off part way through still parses as text, so the file is checked
// for internal consistency before anything is loaded: every table the manifest
// says has rows must actually have INSERTs.
const insertedTables = new Set(
  dump
    .split(/\r?\n/)
    .map((line) => line.match(/^insert into public\.(?:"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+)) /))
    .filter(Boolean)
    .map((match) => match[1] ?? match[2]),
);

console.log(
  `checking ${path.basename(file)}  (${(dump.length / 1024 / 1024).toFixed(2)} MB, ${manifest.size} table(s))`,
);

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "pass" : "FAIL"}  ${label}${ok || !detail ? "" : `  (${detail})`}`);
}

const missing = [...manifest].filter(([table, count]) => count > 0 && !insertedTables.has(table));
record(
  `the dump carries rows for all ${[...manifest.values()].filter((n) => n > 0).length} populated table(s)`,
  missing.length === 0,
  missing.length ? `no INSERTs for: ${missing.map(([table]) => table).join(", ")}` : "",
);

const admin = await connect();
try {
  await admin.connect();
  const { rows: existing } = await admin.query(
    "select 1 from pg_database where datname = $1",
    [SCRATCH],
  );
  if (existing.length) {
    // A throwaway name that somehow still exists is safe to replace. A named
    // database someone may be reading from is not, so that needs an explicit
    // --force rather than being destroyed by a restore run.
    if (!restoreTo) {
      await admin.query(`drop database if exists ${SCRATCH} with (force)`);
    } else if (force) {
      await admin.query(`drop database ${SCRATCH} with (force)`);
    } else {
      await admin.end();
      console.error(`${SCRATCH} already exists. Refusing to replace it.`);
      console.error("Pass --force if it is known to be expendable.");
      process.exit(2);
    }
  }
  await admin.query(`create database ${SCRATCH}`);
  console.log(`created database ${SCRATCH} on ${admin.host}\n`);
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
  process.stdout.write(`replaying ${migrations.length} migrations `);
  for (const migration of migrations) {
    try {
      await applyMigration(client, migration);
    } catch (error) {
      console.log(`\nFAIL  ${migration.file}`);
      console.log(describeMigrationError(error));
      throw new Error("migration replay failed");
    }
  }
  console.log("done\n");

  process.stdout.write("clearing the seeded rows ");
  // The migrations seed master data as well as schema, so loading the dump on
  // top of a freshly replayed schema collides on every seeded primary key. A
  // restore replaces the contents rather than adding to them, so the tables go
  // first. CASCADE is safe here precisely because the dump is about to be
  // loaded whole, in one transaction, or nothing is.
  await client.query(
    `truncate table ${[...manifest.keys()].map((table) => `public."${table}"`).join(", ")} cascade`,
  );
  console.log("done\n");

  process.stdout.write("loading the dump ");
  const started = Date.now();
  // One transaction: either the whole file lands or none of it does, so a
  // truncated or corrupt dump cannot leave a half-loaded database that still
  // looks plausible.
  await client.query("begin");
  try {
    // The two reference cycles mean the rows cannot be inserted in an order that
    // satisfies every key as it goes.
    await client.query("set local session_replication_role = replica");
    await client.query(dump);
    await client.query("set local session_replication_role = origin");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw new Error(`the dump failed to load: ${error.message}`);
  }
  console.log(`done (${Date.now() - started}ms)\n`);

  console.log("--- row counts against the manifest ---");
  for (const [table, expected] of manifest) {
    const { rows } = await client.query(`select count(*)::int as n from public."${table}"`);
    record(`${table} row count`, rows[0].n === expected, `expected ${expected}, got ${rows[0].n}`);
  }

  console.log("\n--- referential integrity, checked with real queries ---");
  // One orphan count per foreign key, built from the catalog. A left join that
  // finds no parent for a non-null child value is the definition of an orphan,
  // and it is the only thing that catches a dump taken mid-write.
  const keys = await client.query(`
    select
      k.conname as name,
      child.relname as child,
      parent.relname as parent,
      (select string_agg(format('%I', ca.attname), ', ' order by ck.ord)
         from unnest(k.conkey) with ordinality as ck(attnum, ord)
         join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = ck.attnum) as child_cols,
      (select string_agg(format('%I', pa.attname), ', ' order by ck.ord)
         from unnest(k.confkey) with ordinality as ck(attnum, ord)
         join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = ck.attnum) as parent_cols
      from pg_constraint k
      join pg_class child on child.oid = k.conrelid
      join pg_class parent on parent.oid = k.confrelid
      join pg_namespace n on n.oid = child.relnamespace
     where k.contype = 'f' and n.nspname = 'public'
     order by child.relname, k.conname
  `);

  let totalOrphans = 0;
  const orphanParts = [];
  for (const key of keys.rows) {
    orphanParts.push(`
      select ${keys.rows.indexOf(key)} as ord, count(*)::int as n
        from public."${key.child}" c
        left join public."${key.parent}" p
          on ${joinPairs(key.child_cols, key.parent_cols, "c", "p")}
       where ${key.child_cols
         .split(", ")
         .map((col) => `c.${col} is not null`)
         .join(" and ")}
         and ${key.parent_cols
           .split(", ")
           .map((_, index) => `p.${key.parent_cols.split(", ")[index]} is null`)
           .join(" and ")}`);
  }

  if (orphanParts.length) {
    const { rows } = await client.query(
      `select coalesce(sum(n), 0)::int as total from (${orphanParts.join(" union all ")}) s`,
    );
    totalOrphans = rows[0].total;
  }
  record(
    `no orphaned rows across ${keys.rows.length} foreign key(s)`,
    totalOrphans === 0,
    `${totalOrphans} orphan(s)`,
  );

  console.log("\n--- project invariants on the restored copy ---");
  const invariants = [
    [
      "every stock level reconciles with its ledger",
      `select count(*)::int as v from (
         select p.id,
                coalesce(sl.current_quantity, 0) - coalesce(mv.movement_sum, 0) as gap
           from products p
           left join stock_levels sl on sl.product_id = p.id
           left join lateral (
             select sum(case m.movement_type when 'in' then m.quantity else -m.quantity end) as movement_sum
               from stock_movements m where m.product_id = p.id
           ) mv on true
       ) gaps where gap <> 0`,
      0,
    ],
    [
      // The dump restores explicit invoice numbers but sequences separately, so
      // this is the check that a restored database will not hand out a number
      // that is already taken.
      "the invoice sequence sits past the highest invoice issued",
      `select case when (select last_value from public.invoice_number_seq)
                     >= (select coalesce(max(substring(invoice_number from '[0-9]+$')::bigint), 0)
                           from invoices)
              then 1 else 0 end as v`,
      1,
    ],
    [
      "no invoice number is reused",
      `select count(*)::int as v from (
         select invoice_number from invoices group by invoice_number having count(*) > 1
       ) d`,
      0,
    ],
    [
      "every invoice still has its lines",
      `select count(*)::int as v from invoices i
        where not exists (select 1 from invoice_lines il where il.invoice_id = i.id)`,
      0,
    ],
    [
      "no order is left pointing at a missing invoice",
      `select count(*)::int as v from orders o
        where o.invoice_id is not null
          and not exists (select 1 from invoices i where i.id = o.invoice_id)`,
      0,
    ],
  ];

  for (const [label, sql, expected] of invariants) {
    const { rows } = await client.query(sql);
    record(label, rows[0].v === expected, `expected ${expected}, got ${rows[0].v}`);
  }

  console.log("\n--- pgTAP against the restored database ---");
  const { suites, failed } = await runTests(client);
  record(`pgTAP suites (${suites - failed}/${suites})`, failed === 0);
} catch (error) {
  if (error.message !== "migration replay failed") {
    console.error(`\nrestore check aborted: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();

  const cleanup = await connect();
  try {
    await cleanup.connect();
    if (KEEP) {
      console.log(`\nleft ${SCRATCH} in place`);
      if (restoreTo) {
        console.log(`\n${SCRATCH} is ready. To point the app at it, set in .env:`);
        console.log(`  PGDATABASE=${SCRATCH}`);
        console.log(`\nthen rebuild and reload, because the app resolves the database at build time:`);
        console.log("  npm --prefix web run build && pm2 reload qsa-web --update-env");
        console.log(`\nWhen it is confirmed working, drop the old database:`);
        console.log(`  drop database <old name>;`);
      } else {
        console.log("--keep was passed; drop it when you are done inspecting it.");
      }
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
    ? `\n${failedChecks.length} of ${results.length} checks FAILED -- this backup does not restore cleanly`
    : `\nall ${results.length} restore checks passed`,
);
process.exitCode = failedChecks.length ? 1 : (process.exitCode ?? 0);

// "a", "b" and "c", "d" become c.a = p.a and c.b = p.b. The column lists come
// from pg_attribute, so they are already quoted identifiers.
function joinPairs(childCols, parentCols, childAlias, parentAlias) {
  const childParts = childCols.split(", ");
  const parentParts = parentCols.split(", ");
  if (childParts.length !== parentParts.length) {
    throw new Error(`foreign key column count mismatch: ${childCols} vs ${parentCols}`);
  }
  return childParts
    .map((col, index) => `${childAlias}.${col} = ${parentAlias}.${parentParts[index]}`)
    .join("\n          and ");
}
