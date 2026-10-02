// Resets the demo account passwords to a known value so the doc screenshots can
// be captured. Direct DB write to auth.users.encrypted_password, using the same
// bcrypt parameters GoTrue itself uses ($2a$06$) so the stored hash is
// indistinguishable from one GoTrue produced.
//
// Only encrypted_password is touched. email_confirmed_at, the identities row and
// everything else are left exactly as they are, so no account is left
// unconfirmed and no session is invalidated.
import { connect } from "./lib/db.mjs";

const NEW_PASSWORD = process.argv[2];
if (!NEW_PASSWORD) {
  console.error("usage: node scripts/tmp-reset-demo-passwords.mjs <password>");
  process.exit(2);
}

const db = connect();
await db.connect();

const { rows: users } = await db.query(
  `select u.email, p.role
     from auth.users as u
     left join public.users as p on p.id = u.id
    order by p.role nulls last, u.email`,
);

console.log("accounts and roles:");
for (const u of users) console.log(`  ${u.email.padEnd(44)} ${u.role ?? "(no profile row)"}`);

// bcrypt is salted per row by crypt(), so every row gets a different hash for the
// same password, which is what GoTrue does.
const { rowCount } = await db.query(
  `update auth.users
      set encrypted_password = crypt($1, gen_salt('bf', 6))
    where email like '%@qsa-demo.in'`,
  [NEW_PASSWORD],
);

const { rows: check } = await db.query(
  `select count(*)::int as total,
          count(*) filter (where encrypted_password like '$2a$06$%')::int as bcrypt06
     from auth.users where email like '%@qsa-demo.in'`,
);

console.log(`\nupdated ${rowCount} demo accounts`);
console.log(`verified: ${check[0].total} accounts, ${check[0].bcrypt06} stored as $2a$06$`);

// Confirm a hash actually matches the new password, rather than trusting the write.
const { rows: verify } = await db.query(
  `select email, (encrypted_password = crypt($1, encrypted_password)) as matches
     from auth.users where email like '%@qsa-demo.in' order by email`,
  [NEW_PASSWORD],
);
const bad = verify.filter((v) => !v.matches);
console.log(`hash round-trip: ${verify.length - bad.length}/${verify.length} verify`);
if (bad.length) console.log("MISMATCH:", bad.map((b) => b.email).join(", "));

db.end();
