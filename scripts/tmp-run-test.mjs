import { connect } from "../scripts/lib/db.mjs";
import { readFileSync } from "node:fs";

const c = await connect();
await c.connect();

const sql = readFileSync("supabase/tests/stage18_dealer_onboarding_test.sql", "utf8");

// Split on statement boundaries the way a simple query would, keeping dollar
// quoted function bodies and string literals intact.
const statements = [];
let i = 0;
let start = 0;
let inDollar = false;
let tag = "";
while (i < sql.length) {
  if (!inDollar && sql[i] === "$") {
    const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i, i + 10));
    if (m) {
      inDollar = true;
      tag = m[0];
      i += tag.length;
      continue;
    }
  }
  if (inDollar && sql.startsWith(tag, i)) {
    inDollar = false;
    i += tag.length;
    continue;
  }
  if (!inDollar && sql[i] === ";") {
    const stmt = sql.slice(start, i + 1);
    if (stmt.trim()) statements.push(stmt);
    start = i + 1;
  }
  i++;
}

console.log("statements: " + statements.length);

for (const [n, stmt] of statements.entries()) {
  try {
    const r = await c.query(stmt);
    if (/from finish\(\)/i.test(stmt)) {
      console.log("finish row: " + JSON.stringify(r.rows));
    }
    if (/^select\s+(is|ok|throws_ok|lives_ok|results_eq)\s*\(/i.test(stmt.trim())) {
      for (const row of r.rows) {
        if (row.ok === false || /not ok/.test(JSON.stringify(row))) {
          const where = /-- ([^,]+)$/.exec(stmt.trim().split("\n").pop() + "");
          console.log("  NOT OK: " + JSON.stringify(row));
        }
      }
    }
  } catch (e) {
    const firstLine = stmt.trim().split("\n").find((l) => l.trim()) ?? "";
    console.log(
      "FAIL #" + (n + 1) + " :: " + e.message + "\n   > " + firstLine.slice(0, 110),
    );
    break;
  }
}

console.log("loop done");

await c.query("rollback").catch(() => {});
await c.end();
