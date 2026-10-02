// Pulls the authoritative workflow facts out of the live schema: the order status
// enum, the tables that drive each portal, and the volume of real demo data per
// status, so the documents describe the system that exists rather than one
// inferred from reading React.
import { connect } from "./lib/db.mjs";

const db = connect();
await db.connect();

const q = async (label, sql) => {
  const { rows } = await db.query(sql);
  console.log(`\n=== ${label} ===`);
  console.table(rows);
  return rows;
};

await q("order status enum", `select e.enumlabel as status, e.enumsortorder as ord
  from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'order_status' order by e.enumsortorder`);

await q("orders by status (live demo data)", `select status::text, count(*)::int as orders,
    min(created_at)::date as first, max(created_at)::date as last
  from public.orders group by status order by count(*) desc`);

await q("public tables", `select table_name from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);

await q("user roles", `select role, count(*)::int as people from public.users group by role order by role`);

await q("dealers", `select d.status::text as status, count(*)::int as dealers,
    count(d.sales_rep_id)::int as mapped_to_rep
  from public.dealers d group by d.status order by count(*) desc`);

await q("security definer functions (the actions)", `select p.proname as function,
    pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
 order by p.proname`);

db.end();
