import { connect } from "./lib/db.mjs";
import { readFileSync } from "node:fs";
const c = await connect();
await c.connect();
const sql = readFileSync(process.argv[2], "utf8");
for (const line of sql.split(";").map(s=>s.trim()).filter(s=>s && !s.startsWith("--"))) {
  try { const r = await c.query(line); console.log(line.slice(0,60).replace(/\s+/g," "), "=>", JSON.stringify(r.rows)); }
  catch (e) { console.log(line.slice(0,60).replace(/\s+/g," "), "=> ERR", e.message); }
}
await c.end();
