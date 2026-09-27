// Takes a logical backup of the live database and prunes old ones.
//
//   npm run db:backup
//   npm run db:backup -- --list
//   npm run db:backup -- --keep-days 30 --keep-count 60
//   npm run db:backup -- --out D:\qsa-backups
//
// This is deliberately not a wrapper around pg_dump. The deployment target is a
// Linux VPS that will have pg_dump, but the machine this is developed on does
// not, and a backup routine that cannot be run where it is written is a backup
// routine nobody runs. Everything here goes through the same pg client the rest
// of the tooling uses, so it works anywhere Node does.
//
// Two things this has to get right, and both are easy to get wrong by hand:
//
//   * Escaping. Every literal is produced by PostgreSQL's format('%L') rather
//     than by string surgery in this file, so a product name with an apostrophe
//     in it round-trips.
//   * Sequences. The dump restores explicit primary keys, which leaves every
//     sequence sitting at its initial value. A restored database that hands out
//     invoice QSA-2026-000001 a second time is worse than no backup at all, so
//     every sequence is set forward with setval.
//
// The dump is data only. Constraints, triggers, RLS policies, grants, views and
// SECURITY DEFINER functions are exactly what a hand-rolled catalog dump gets
// subtly wrong, and this project can already rebuild all of them by replaying
// supabase/migrations. db-restore-check.mjs does that, then loads this data,
// which is what makes the pair a restore proof rather than two hopeful files.
import fs from "node:fs";
import path from "node:path";
import { connect, REPO_ROOT } from "./lib/db.mjs";

const args = process.argv.slice(2);

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

const outDir = path.resolve(flag("out", path.join(REPO_ROOT, "backups")));
const keepDays = Number(flag("keep-days", "14"));
const keepCount = Number(flag("keep-count", "20"));

for (const [name, value] of [["--keep-days", keepDays], ["--keep-count", keepCount]]) {
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} must be a positive whole number`);
    process.exit(2);
  }
}

const PREFIX = "qsa-";
const SUFFIX = ".sql";

const listBackups = () =>
  !fs.existsSync(outDir)
    ? []
    : fs
        .readdirSync(outDir)
        .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
        .map((name) => {
          const full = path.join(outDir, name);
          return { name, full, size: fs.statSync(full).size, mtime: fs.statSync(full).mtime };
        })
        .sort((a, b) => b.name.localeCompare(a.name));

if (args.includes("--list")) {
  const backups = listBackups();
  if (!backups.length) {
    console.log(`no backups in ${outDir}`);
    process.exit(0);
  }
  for (const backup of backups) {
    console.log(
      `${backup.name}  ${(backup.size / 1024 / 1024).toFixed(2)} MB  ${backup.mtime.toISOString()}`,
    );
  }
  console.log(`\n${backups.length} backup(s) in ${outDir}`);
  process.exit(0);
}

// Parents before children, so a restore satisfies foreign keys as it goes. Read
// from pg_constraint rather than a hardcoded list: a hand-maintained ordering is
// exactly the kind of list that goes stale the day somebody adds a table.
async function tablesInRestoreOrder(client) {
  const { rows: tables } = await client.query(`
    select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `);
  const { rows: edges } = await client.query(`
    select child.relname as child, parent.relname as parent
      from pg_constraint k
      join pg_class child on child.oid = k.conrelid
      join pg_class parent on parent.oid = k.confrelid
      join pg_namespace n on n.oid = child.relnamespace
     where k.contype = 'f'
       and n.nspname = 'public'
       and k.confrelid <> k.conrelid
  `);

  const names = tables.map((row) => row.name);
  const present = new Set(names);
  const waits = new Map(names.map((name) => [name, new Set()]));
  const dependents = new Map(names.map((name) => [name, new Set()]));

  for (const edge of edges) {
    if (!present.has(edge.child) || !present.has(edge.parent)) continue;
    if (waits.get(edge.child).has(edge.parent)) continue;
    waits.get(edge.child).add(edge.parent);
    dependents.get(edge.parent).add(edge.child);
  }

  const ready = names.filter((name) => waits.get(name).size === 0);
  const ordered = [];
  while (ready.length) {
    const name = ready.shift();
    ordered.push(name);
    for (const child of dependents.get(name)) {
      waits.get(child).delete(name);
      if (waits.get(child).size === 0) ready.push(child);
    }
  }

  // This schema has two genuine reference cycles -- orders.invoice_id points at
  // invoices while invoices.order_id points back at orders, and users.dealer_id
  // points at dealers while dealers.sales_rep_id points back at users -- and
  // none of the constraints are deferrable. So there is no order in which a
  // plain INSERT stream satisfies them. Everything that can be ordered is; the
  // rest is appended deterministically, and the load runs with trigger
  // enforcement off. That is safe precisely because the rows came out of a
  // database that already satisfied every one of them, and
  // db-restore-check.mjs then proves it rather than assuming it.
  const stuck = names.filter((name) => !ordered.includes(name));
  if (stuck.length) {
    ordered.push(...stuck.sort());
    console.log(
      `  note: ${stuck.length} table(s) sit in a foreign key cycle ` +
        `(${stuck.join(", ")}); they load last, with triggers off`,
    );
  }
  return ordered;
}

// Columns worth dumping: everything except generated columns, which the server
// computes and will refuse an explicit value for. Identity columns keep their
// explicit value, because the point is to preserve keys.
async function dumpableColumns(client, table) {
  const { rows } = await client.query(
    `select attname as name
       from pg_attribute
      where attrelid = $1::regclass
        and attnum > 0
        and not attisdropped
        and attgenerated = ''
      order by attnum`,
    [`public.${table}`],
  );
  return rows.map((row) => row.name);
}

// Values are rendered by the server, one statement per row, so escaping is
// PostgreSQL's job rather than this script's. The column names are interpolated
// as quoted identifiers because a function argument cannot take a %I as a column
// reference; they come from pg_attribute, not from input.
//
// concat_ws rather than string_agg: it takes the value expressions as arguments
// directly, so a column cannot go missing from the list the way a NULL input
// would drop it from a string_agg.
async function dumpTable(client, table, columns) {
  const collist = columns.map(quoteIdent).join(", ");
  const values = columns
    .map(
      (column) =>
        `case when t.${quoteIdent(column)} is null then 'null' ` +
        `else format('%L', t.${quoteIdent(column)}) end`,
    )
    .join(", ");

  const { rows } = await client.query(`
    select string_agg(stmt, E'\\n' order by ord) as body, count(*)::int as n
      from (
        select format('insert into public.%I (${collist}) values (%s);',
                      ${quoteLiteral(table)},
                      concat_ws(', ', ${values})) as stmt,
               row_number() over () as ord
          from public.${quoteIdent(table)} t
      ) s
  `);
  return rows[0];
}

// A restored database that hands out an invoice number twice is worse than no
// backup, so every sequence is moved to where it actually was.
async function dumpSequences(client) {
  const { rows } = await client.query(`
    select n.nspname as schema, s.sequencename as name, s.last_value
      from pg_sequences s
      join pg_namespace n on n.nspname = s.schemaname
     where s.schemaname = 'public'
     order by s.sequencename
  `);

  return rows.map((row) => {
    const qualified = `${quoteIdent(row.schema)}.${quoteIdent(row.name)}`;
    // A sequence nobody has called has a null last_value. setval(_, 1, false)
    // leaves it one before its first value, which is the right resting place.
    const value = row.last_value === null ? "1" : String(row.last_value);
    const called = row.last_value === null ? "false" : "true";
    return `select setval('${qualified}', ${value}, ${called});`;
  });
}

const client = await connect();
let written = null;

try {
  await client.connect();

  const tables = await tablesInRestoreOrder(client);
  console.log(`dumping ${tables.length} table(s) from ${client.host}/${client.database}`);

  const parts = [
    "-- QSA Industries ERP logical backup",
    `-- taken:  ${new Date().toISOString()}`,
    `-- source: ${client.host}/${client.database}`,
    "",
    "-- Data only. The schema comes from replaying supabase/migrations, which is",
    "-- what db-restore-check.mjs does. Verify a restore with:",
    "--",
    "--   npm run db:restore-check",
    "--",
    "-- orders and invoices reference each other, as do users and dealers, and",
    "-- neither pair is deferrable. Load this inside a transaction that has run",
    "--   set session_replication_role = replica;",
    "-- and set it back to origin afterwards. The rows came from a database that",
    "-- already satisfied every constraint, so skipping the checks while loading",
    "-- is safe; db-restore-check.mjs verifies them again once the data is in.",
    "",
    "set client_min_messages = warning;",
    "",
  ];

  let rowTotal = 0;
  const manifest = [];

  for (const table of tables) {
    const columns = await dumpableColumns(client, table);
    if (!columns.length) continue;

    const dumped = await dumpTable(client, table, columns);
    if (!dumped.n) {
      manifest.push([table, 0]);
      console.log(`  ${table}: empty`);
      continue;
    }

    rowTotal += dumped.n;
    manifest.push([table, dumped.n]);
    parts.push(`-- ${table}: ${dumped.n} row(s)`);
    parts.push(dumped.body);
    parts.push("");
    console.log(`  ${table}: ${dumped.n} row(s)`);
  }

  // A restore is checked against the row counts the dump was taken at, not
  // against the live database at restore time. Comparing against live would make
  // the check fail for the wrong reason the moment anything else writes.
  parts.push("-- manifest: <table> <row count>");
  for (const [table, count] of manifest) {
    parts.push(`-- manifest: ${table} ${count}`);
  }
  parts.push("");

  parts.push("-- sequences");
  parts.push(...(await dumpSequences(client)));
  parts.push("");
  parts.push("set client_min_messages = notice;");
  parts.push("");

  fs.mkdirSync(outDir, { recursive: true });
  const name = `${PREFIX}${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}${SUFFIX}`;
  const target = path.join(outDir, name);
  fs.writeFileSync(target, parts.join("\n"), "utf8");

  written = { name, size: fs.statSync(target).size };
  console.log(
    `\nwrote ${name}  (${(written.size / 1024 / 1024).toFixed(2)} MB, ${rowTotal} row(s))`,
  );
} finally {
  await client.end();
}

// Retention: the count cap first, then the age cap over what survives it. Both
// are needed -- one backup a day needs the age cap, forty a day needs the count
// cap or it fills the disk.
const all = listBackups();
const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
const doomed = new Set(all.slice(keepCount).map((backup) => backup.name));
for (const backup of all.slice(0, keepCount)) {
  if (backup.mtime.getTime() < cutoff) doomed.add(backup.name);
}

for (const name of doomed) {
  fs.rmSync(path.join(outDir, name), { force: true });
  console.log(`pruned ${name}`);
}

console.log(
  `\n${listBackups().length} backup(s) in ${outDir} (newest ${keepCount}, and anything under ${keepDays} day(s) old)`,
);
if (written) console.log(`prove it restores with: npm run db:restore-check`);

// Names come from pg_class, never from user input, so doubling quotes is belt
// and braces rather than the security boundary.
function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
