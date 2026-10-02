import { connect } from "./lib/db.mjs";
import { readFileSync } from "node:fs";
const c = await connect();
await c.connect();
const sql = readFileSync(process.argv[2], "utf8");
try { await c.query(sql); console.log("OK"); }
catch (e) { console.log("ERR:", e.message, "| position:", e.position ?? e.where ?? "?"); }
await c.query("rollback").catch(()=>{});
await c.end();
