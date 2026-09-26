// Repairs incomplete rows in supabase_migrations.schema_migrations.
//
//   npm run db:history-backfill
//
// Rows written by older versions of this runner recorded only `version` and a
// filename-with-extension in `name`, leaving `statements` NULL. Versions were
// present, so the table looked healthy while carrying no SQL for most of its
// rows -- which is exactly what makes `supabase db reset` unsafe here.
//
// Every value written is re-derived from the migration files in this repository,
// so the backfill is idempotent and can be re-run after adding files. It touches
// the history table only: no business table, schema or function is modified.
//
// The Supabase CLI splits a migration into individual statements; this runner
// sends each file as one multi-statement query, so a backfilled row gets a
// single-element array holding the whole file. That records what actually ran,
// but it is still not a CLI-shaped split, so `supabase db reset` remains
// unsupported -- use npm run db:verify-fresh, which replays the files.
import {
  connect,
  listMigrations,
} from "./lib/db.mjs";
const client = await connect();

try {
  await client.connect();

  const files = new Map(listMigrations().map((m) => [m.version, m]));
  const { rows } = await client.query(
    `select version, name, statements is null as no_statements
     from supabase_migrations.schema_migrations
     order by version`,
  );

  const stale = rows.filter((r) => {
    const file = files.get(r.version);
    return file && (r.no_statements || r.name !== file.name);
  });

  if (stale.length === 0) {
    console.log(`all ${rows.length} history rows already complete`);
  } else {
    console.log(`${stale.length} of ${rows.length} history rows need repair\n`);

    await client.query("begin");
    try {
      for (const row of stale) {
        const file = files.get(row.version);
        const name = file.name;
        await client.query(
          `update supabase_migrations.schema_migrations
           set name = $2, statements = $3
           where version = $1`,
          [row.version, name, [file.sql]],
        );
        console.log(
          `  ${row.version}  name ${JSON.stringify(row.name)} -> ${JSON.stringify(name)}` +
            `  statements ${row.no_statements ? "NULL" : "kept"} -> 1 element` +
            ` (${file.sql.length} bytes)`,
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
    console.log("\ncommitted");
  }

  const after = await client.query(
    `select count(*)::int as total,
            count(*) filter (where statements is null)::int as null_statements,
            count(*) filter (where name like '%.sql' or name ~ '^[0-9]{14}')::int as bad_names
     from supabase_migrations.schema_migrations`,
  );
  const a = after.rows[0];
  console.log(
    `history now: ${a.total} rows, ${a.null_statements} without SQL, ` +
      `${a.bad_names} named like a filename`,
  );

  const unknown = await client.query(
    `select version, name from supabase_migrations.schema_migrations
     where not exists (select 1 from unnest($1::text[]) v where v = version)`,
    [[...files.keys()]],
  );
  if (unknown.rowCount > 0) {
    console.log(
      `\nwarning: ${unknown.rowCount} recorded version(s) have no file in ` +
        `supabase/migrations and were left untouched:`,
    );
    for (const r of unknown.rows) console.log(`  ${r.version}  ${r.name ?? "(no name)"}`);
  }
} catch (error) {
  console.error(`history backfill failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
