// Checks whether dealer_rep_coverage actually has a full_name column, which
// getRepCoverage orders by. A mismatch makes PostgREST reject the whole query.
import { connect } from "./lib/db.mjs";

const db = connect();
await db.connect();

const { rows: cols } = await db.query(`
  select column_name, data_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'dealer_rep_coverage'
   order by ordinal_position`);

console.log("dealer_rep_coverage columns:");
for (const c of cols) console.log(`  ${c.column_name.padEnd(24)} ${c.data_type}`);

const names = cols.map((c) => c.column_name);
console.log(`\nhas full_name?  ${names.includes("full_name")}`);
console.log(`has rep_name?   ${names.includes("rep_name")}`);

const { rows: sample } = await db.query(`select * from public.dealer_rep_coverage limit 5`);
console.log("\nsample rows:");
console.table(sample);

db.end();
