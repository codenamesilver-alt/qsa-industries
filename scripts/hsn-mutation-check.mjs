// Proves the 20260926100500 assertions are load-bearing, not decorative.
//
// The consolidation removed a redundant constraint, which is exactly the kind of
// change that can leave a suite passing while proving nothing. So this walks a
// fresh install through three states and checks stage11 reacts to each.
//
// The states matter more than they look. The two pre-consolidation constraints
// on products were not redundant with each other, they were contradictory, and
// each one alone produces a different bug:
//
//   both present     the strict pattern wins, 5/7 digits are refused, and the
//                    rule is correct but stated twice, so a future edit to
//                    either one can silently break it
//   loose only       '^[0-9]{4,8}$' becomes the whole rule, and 5 and 7 digit
//                    tax codes start invoicing
//   consolidated     one constraint, 4/6/8 digits, no second reading needed
//
// So a single mutation proves only half the case. Both regressions are run here.
//
// Runs entirely in a scratch database. The live target is never touched.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  TESTS_DIR,
  applyMigration,
  bootstrapPlatform,
  connect,
  ensureMigrationsTable,
  ensurePgtap,
  listMigrations,
} from "./lib/db.mjs";

const SCRATCH = "qsadb_hsn_mutation";

// db-verify-fresh guards its scratch name because it is interpolated into
// CREATE/DROP DATABASE, which cannot take a bound parameter. Same applies here:
// the name is a literal from this file and nothing else.
if (!/^[a-z_][a-z0-9_]*$/.test(SCRATCH)) throw new Error("unsafe scratch name");

const STRICT = "^[0-9]{4}([0-9]{2})?([0-9]{2})?$";
const LOOSE = "^[0-9]{4,8}$";

// Postgres does not accept bind parameters inside a CHECK expression, so the
// two patterns are interpolated. Both are literals declared above and neither
// comes from input, so there is nothing to inject.
async function setProductConstraints(client, { format, required }) {
  await client.query(`
    alter table public.products
      drop constraint if exists products_hsn_code_format,
      drop constraint if exists products_hsn_code_required;
  `);
  if (format) {
    await client.query(
      `alter table public.products add constraint products_hsn_code_format
         check (hsn_code is null or hsn_code ~ '${format}')`,
    );
  }
  if (required) {
    await client.query(
      `alter table public.products add constraint products_hsn_code_required
         check (hsn_code is not null and btrim(hsn_code) <> '' and hsn_code ~ '${required}')`,
    );
  }
}

const admin = await connect();
await admin.connect();
await admin.query(`drop database if exists ${SCRATCH} with (force)`);
await admin.query(`create database ${SCRATCH}`);
await admin.end();
console.log(`created scratch database ${SCRATCH}\n`);

const client = await connect({ database: SCRATCH });
const problems = [];

try {
  await client.connect();
  await ensureMigrationsTable(client);
  await bootstrapPlatform(client);
  // A brand new database has no pgtap, and the suite's plan() call is the first
  // thing that notices.
  await ensurePgtap(client);

  const migrations = listMigrations();
  for (const migration of migrations) {
    await applyMigration(client, migration);
  }
  console.log(`replayed ${migrations.length} migrations into the scratch database\n`);

  const suite = await readFile(
    join(TESTS_DIR, "stage11_compliance_procurement_test.sql"),
    "utf8",
  );

  // The suite returns one row per assertion in a single column whose name is not
  // worth depending on, so every string value is flattened the way the lib does.
  async function failures() {
    const result = await client.query(
      "set local search_path = extensions, public, private;\n" + suite,
    );
    const rows = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows ?? []);
    return rows
      .flatMap((row) => Object.values(row))
      .filter((value) => typeof value === "string")
      .flatMap((value) => value.split("\n"))
      .map((line) => line.trim())
      .filter((line) => line.startsWith("not ok"))
      .map((line) => line.replace(/^not ok \d+ - /, "").split("#")[0].trim());
  }

  const scenarios = [
    {
      name: "consolidated (the shipped state)",
      constraints: { format: null, required: STRICT },
      expect: [],
      note: "one constraint, strict pattern. Nothing should fail.",
    },
    {
      name: "both constraints back (pre-consolidation state)",
      constraints: { format: STRICT, required: LOOSE },
      expect: ["products carries exactly one tax code constraint"],
      note: "behaviour is still correct, because the strict pattern wins. Only the duplication is wrong, so only the count guard should fire.",
    },
    {
      name: "loose constraint alone",
      constraints: { format: null, required: LOOSE },
      expect: [
        "a five digit tax code is refused",
        "a seven digit tax code is refused",
      ],
      note: "the strict constraint is gone, so the loose regex is now the whole rule. Only the digit guards should fire.",
    },
  ];

  for (const [i, scenario] of scenarios.entries()) {
    await setProductConstraints(client, scenario.constraints);
    const got = await failures();

    console.log(`--- ${i + 1}. ${scenario.name} ---`);
    console.log(`    ${scenario.note}`);
    if (got.length === 0) console.log("    no assertion failed");

    const expected = new Set(scenario.expect);
    for (const line of got) {
      const wanted = expected.has(line);
      console.log(`      ${wanted ? "expected" : "UNEXPECTED"}  ${line}`);
    }
    for (const line of scenario.expect) {
      if (!got.includes(line)) {
        console.log(`      MISSING     ${line}`);
        problems.push(`${scenario.name}: guard did not fire for "${line}"`);
      }
    }
    for (const line of got) {
      if (!expected.has(line)) {
        problems.push(`${scenario.name}: unexpected failure "${line}"`);
      }
    }
    console.log("");
  }
} catch (error) {
  console.error(`mutation check aborted: ${error.message}`);
  problems.push(`aborted: ${error.message}`);
} finally {
  await client.end();

  const cleanup = await connect();
  try {
    await cleanup.connect();
    await cleanup.query(`drop database if exists ${SCRATCH} with (force)`);
    console.log(`dropped scratch database ${SCRATCH}`);
  } finally {
    await cleanup.end();
  }
}

if (problems.length > 0) {
  console.log("\nthe new assertions are not fully load-bearing:");
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log(
    "\neach guard fires for its own regression and stays quiet for the other, so the consolidation is guarded rather than merely asserted",
  );
}
