// Checks every .from(view) .order(column) pair in data.ts against the live view
// columns. An order-by on a column the relation does not have makes PostgREST
// reject the whole query, so the page fails rather than rendering unsorted. That
// is the same defect class as the full_name/rep_name bug in getRepCoverage.
import fs from "node:fs";
import { connect } from "./lib/db.mjs";

const src = fs.readFileSync("web/src/lib/data.ts", "utf8");

// Each getter: a .from("x") ... .order("y") pair, allowing chained calls between.
const pattern = /\.from\("([a-z_]+)"\)((?:.|\n){0,400}?)\.order\("([a-z_]+)"\)/g;
const pairs = [];
let m;
while ((m = pattern.exec(src)) !== null) {
  pairs.push({ view: m[1], order: m[3] });
}

const db = connect();
await db.connect();
const { rows: rels } = await db.query(`
  select c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','v','m')
   order by c.relname`);
const kinds = new Map(rels.map((r) => [r.relname, r.relkind]));

const { rows: allCols } = await db.query(`
  select table_name, column_name from information_schema.columns
   where table_schema = 'public'`);
const colsBy = new Map();
for (const c of allCols) {
  if (!colsBy.has(c.table_name)) colsBy.set(c.table_name, new Set());
  colsBy.get(c.table_name).add(c.column_name);
}

console.log(`checked ${pairs.length} .from/.order pairs in data.ts\n`);
let bad = 0;
for (const p of pairs) {
  const kind = kinds.get(p.view);
  if (!kind) continue; // a base table name we did not resolve; ignore
  const cols = colsBy.get(p.view);
  const ok = cols?.has(p.order);
  if (!ok) {
    bad += 1;
    console.log(`  BROKEN  ${p.view} (${kind === "v" ? "view" : "table"}) .order("${p.order}")`);
    console.log(`          available: ${[...(cols ?? [])].join(", ")}`);
  } else {
    console.log(`  ok      ${p.view}.${p.order}`);
  }
}
console.log(`\n${bad} broken order-by clause(s)`);
db.end();
process.exit(bad ? 1 : 0);
