// Dumps the real account roster straight from the database so the credentials file
// is generated from source of truth, not from notes that can drift.
import { connect } from "./lib/db.mjs";

const db = connect();
await db.connect();

const { rows: columns } = await db.query(
  `select column_name, data_type
     from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
    order by ordinal_position`,
);
console.log("public.users columns:");
console.log(columns.map((c) => `${c.column_name}:${c.data_type}`).join(", "));

const { rows } = await db.query(
  `select u.email,
          u.email_confirmed_at is not null as confirmed,
          p.full_name,
          p.role,
          p.is_active,
          p.phone,
          p.designation_id is not null as has_designation,
          p.reports_to_id is not null as has_manager,
          d.name as dealer_name
     from auth.users as u
     left join public.users as p on p.id = u.id
     left join public.dealers as d on d.id = p.dealer_id
    order by p.role nulls last, u.email`,
);

console.log(`\n${rows.length} account(s):`);
for (const r of rows) {
  console.log(
    [
      r.email,
      `role=${r.role ?? "-"}`,
      `name=${r.full_name ?? "-"}`,
      `active=${r.is_active}`,
      `confirmed=${r.confirmed}`,
      r.dealer_name ? `dealer=${r.dealer_name}` : "",
    ].join("  "),
  );
}

await db.end();
