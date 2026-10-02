// Proves the reset actually works by signing in through the real Supabase auth API
// with the publishable key, exactly as the browser will. A hash that verifies
// against crypt() is not the same as a token GoTrue will issue.
import { connect } from "./lib/db.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const raw of fs.readFileSync(path.join(REPO, "web", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("missing Supabase URL or publishable key in web/.env.local");
  process.exit(2);
}

const PASSWORD = process.argv[2];
const db = connect();
await db.connect();
const { rows: users } = await db.query(
  `select u.email, p.role
     from auth.users as u left join public.users as p on p.id = u.id
    where u.email like '%@qsa-demo.in' order by p.role nulls last, u.email`,
);

let ok = 0;
let failed = 0;
for (const u of users) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: PASSWORD }),
  });
  const body = await res.json();
  if (res.ok && body.access_token) {
    ok += 1;
    console.log(`  OK    ${u.email.padEnd(44)} ${u.role}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${u.email.padEnd(44)} ${res.status} ${body.error_description ?? body.msg ?? body.error ?? ""}`);
  }
}
console.log(`\nsign-in via auth API: ${ok} ok, ${failed} failed, of ${users.length}`);
db.end();
process.exit(failed ? 1 : 0);
