import { connect } from "./lib/db.mjs";
import { readFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/tmp-sql.mjs <file.sql>");
  process.exit(2);
}

const c = await connect();
await c.connect();

const sql = readFileSync(target, "utf8").replace(/^\uFEFF/, "");

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
  // A semicolon inside a line comment is not a statement end. The repo splitter
  // never sees this because the test runner sends a whole file as one query, but
  // this runner has to split, so it has to know about comments.
  if (!inDollar && sql[i] === "-" && sql[i + 1] === "-") {
    const end = sql.indexOf("\n", i);
    i = end === -1 ? sql.length : end;
    continue;
  }
  if (!inDollar && sql[i] === ";") {
    const stmt = sql.slice(start, i + 1);
    if (stmt.trim()) statements.push(stmt);
    start = i + 1;
  }
  i++;
}

console.log(`${target}: ${statements.length} statements`);

for (const [n, stmt] of statements.entries()) {
  try {
    const r = await c.query(stmt);
    if (/from finish\(\)/i.test(stmt)) {
      console.log("finish: " + JSON.stringify(r.rows));
    }
    if (/^select\s+(is|isnt|ok|throws_ok|lives_ok|results_eq)\s*\(/i.test(stmt.trim())) {
      for (const row of r.rows) {
        if (row.ok === false || /not ok/i.test(JSON.stringify(row))) {
          console.log("  NOT OK: " + JSON.stringify(row));
        }
      }
    }
  } catch (e) {
    const firstLine = stmt.trim().split("\n").find((l) => l.trim()) ?? "";
    console.log(`FAIL #${n + 1} :: ${e.message}\n   > ${firstLine.slice(0, 160)}`);
    break;
  }
}

await c.query("rollback").catch(() => {});
await c.end();
