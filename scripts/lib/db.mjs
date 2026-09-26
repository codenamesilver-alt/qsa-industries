// Shared helpers for the database scripts: connection handling, migration
// discovery, and the pgTAP runner. Every script reads its target from the
// standard libpq environment variables so nothing has to be hardcoded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const TESTS_DIR = path.join(REPO_ROOT, "supabase", "tests");
export const PLATFORM_STUB = path.join(HERE, "platform-stub.sql");

// Environment variable name, and the key it is exposed as on the pg config.
const REQUIRED = [
  ["PGHOST", "host"],
  ["PGUSER", "user"],
  ["PGPASSWORD", "password"],
];

// Loads the repo .env into process.env without overriding anything already set,
// so real environment variables always win. Small enough to skip a dependency,
// and it means `npm run db:test` works without an export step -- npm on Windows
// does not reliably pass the parent environment through to run-scripts.
function loadDotEnv() {
  const file = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}


export function resolveConfig(overrides = {}) {
  loadDotEnv();

  const config = {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "postgres",
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    ...overrides,
  };

  const missing = REQUIRED.filter(([, configKey]) => !config[configKey]).map(
    ([envKey]) => envKey,
  );
  if (missing.length) {
    console.error(
      `Missing ${missing.join(", ")}.\n` +
        "Copy .env.example to .env in the repository root and fill in the values, " +
        "or export the variables yourself.",
    );
    process.exit(2);
  }
  return config;
}

export function connect(overrides = {}) {
  return new pg.Client(resolveConfig(overrides));
}

// A migration filename is <14-digit version>_<name>.sql.
const VERSION_LENGTH = 14;

// The Supabase CLI records `name` as the filename with the leading version and
// the .sql extension removed: 20260925081840_day1_schema_foundation.sql is stored
// as `day1_schema_foundation`. Two rows in the live history table were written by
// the CLI and two earlier runners did not agree with that, so every writer goes
// through here instead of trimming the filename inline.
export function migrationName(file) {
  return file.replace(/^\d{14}[-_]?/, "").replace(/\.sql$/, "");
}

export function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      version: file.slice(0, VERSION_LENGTH),
      name: migrationName(file),
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
    }));
}

export function listTests() {
  return fs
    .readdirSync(TESTS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: fs.readFileSync(path.join(TESTS_DIR, file), "utf8"),
    }));
}

// pgTAP lives in the extensions schema, and the suites switch to anon mid-file,
// so anon needs USAGE on it. Supabase grants this already; see platform-stub.sql
// for a standalone database.
export async function ensurePgtap(client) {
  await client.query("create schema if not exists extensions");
  await client.query("create extension if not exists pgtap with schema extensions");
}

export async function bootstrapPlatform(client) {
  await client.query(fs.readFileSync(PLATFORM_STUB, "utf8"));
}

export async function ensureMigrationsTable(client) {
  await client.query("create schema if not exists supabase_migrations");
  // Deliberately the same three columns, in the same order, that the Supabase
  // CLI creates for itself. Two of the rows in the live table were applied by
  // the CLI, so the two writers have to agree on the shape. Note that
  // `create table if not exists` is a no-op against an existing table, so this
  // only ever creates the table, it never alters one -- keep the DDL in step
  // with whatever is already deployed rather than assuming it lands.
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     )`,
  );
}

export async function appliedVersions(client) {
  const { rows } = await client.query(
    "select version from supabase_migrations.schema_migrations",
  );
  return new Set(rows.map((row) => row.version));
}

// Each migration runs in its own transaction together with the history row, so a
// failure leaves neither the schema change nor a false history entry behind.
// The row records the SQL that actually ran. This runner sends each file to the
// server as a single multi-statement query, so `statements` holds one element:
// the whole file. That is honest about what was applied, but it is not the
// per-statement split the Supabase CLI writes, which is why `supabase db reset`
// cannot rebuild this project -- use scripts/db-verify-fresh.mjs, which replays
// the files themselves.
export async function applyMigration(client, migration) {
  await client.query("begin");
  try {
    await client.query(migration.sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3)`,
      [migration.version, migration.name, [migration.sql]],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

export function describeMigrationError(error) {
  const lines = [`      ${error.message}`];
  if (error.detail) lines.push(`      detail: ${error.detail}`);
  if (error.hint) lines.push(`      hint: ${error.hint}`);
  return lines.join("\n");
}

// pgTAP reports by returning its TAP output as single-column rows: the column is
// named after the assertion type (is, throws_ok, plan, finish) and the value is
// a TAP line. A suite is a multi-statement query, so node-postgres answers with
// an ARRAY of results, one per statement. Reading `.rows` off the array, or
// looking for typed columns like not_ok, silently reports every suite as passing
// -- so flatten to text and parse the TAP lines instead.
export async function runTests(client) {
  await ensurePgtap(client);
  const tests = listTests();
  let failed = 0;
  let totalRun = 0;
  let totalFailed = 0;

  for (const test of tests) {
    const preamble = "set local search_path = extensions, public, private;\n";
    let rows;
    try {
      const result = await client.query(preamble + test.sql);
      rows = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows ?? []);
    } catch (error) {
      console.log(`ERROR ${test.file}`);
      console.log(describeMigrationError(error));
      await client.query("rollback").catch(() => {});
      failed += 1;
      continue;
    }

    const lines = rows
      .flatMap((row) => Object.values(row))
      .filter((value) => typeof value === "string")
      .flatMap((value) => value.split("\n"))
      .map((line) => line.trim())
      .filter(Boolean);

    const assertions = lines.filter((line) => /^(not )?ok\b/.test(line));
    const failures = lines.filter((line) => line.startsWith("not ok"));
    const plan = lines.find((line) => /^1\.\.\d+$/.test(line));

    if (assertions.length === 0) {
      console.log(`ERROR ${test.file}  (no TAP output: the suite produced no assertions)`);
      if (lines.length) for (const line of lines) console.log(`      ${line}`);
      failed += 1;
      continue;
    }

    const planned = plan ? Number(plan.slice(3)) : assertions.length;
    const complete = planned === assertions.length;
    totalRun += assertions.length;
    totalFailed += failures.length;

    const ok = failures.length === 0 && complete;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${test.file}  (${assertions.length} run, ${failures.length} failed${complete ? "" : `, plan said ${planned}`})`,
    );
    for (const line of lines) {
      if (line.startsWith("not ok") || /^#\s*(Failed test|have:|want:|Looks like)/.test(line)) {
        console.log(`      ${line}`);
      }
    }
    if (!ok) failed += 1;
  }

  return { suites: tests.length, failed, totalRun, totalFailed };
}
