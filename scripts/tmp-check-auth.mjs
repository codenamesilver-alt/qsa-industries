import { connect } from "./lib/db.mjs";

const db = connect();
await db.connect();
const { rows } = await db.query(
  `select email,
          left(encrypted_password, 7) as hash_prefix,
          (email_confirmed_at is not null) as confirmed,
          (last_sign_in_at is not null) as signed_in_before
     from auth.users
    order by email`,
);
console.log(`auth.users rows: ${rows.length}`);
for (const r of rows) {
  console.log(
    `  ${r.email.padEnd(44)} ${String(r.hash_prefix).padEnd(8)} confirmed=${r.confirmed} signedIn=${r.signed_in_before}`,
  );
}
const { rows: ext } = await db.query(`select extname from pg_extension order by extname`);
console.log(`\nextensions: ${ext.map((e) => e.extname).join(", ")}`);
db.end();
