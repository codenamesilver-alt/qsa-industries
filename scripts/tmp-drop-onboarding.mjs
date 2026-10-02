import * as m from "../scripts/lib/db.mjs";

const c = await m.connect();
await c.connect();

await c.query("drop view if exists public.dealer_onboarding_board");
await c.query("drop table if exists public.dealer_onboardings cascade");
await c.query("delete from supabase_migrations.schema_migrations where version = $1", [
  "20260928104000",
]);

console.log("dropped onboarding objects and history row");

await c.end();
