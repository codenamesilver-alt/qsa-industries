// Re-applies one already-recorded migration from its file.
//
//   npm run db:migration-redo -- 20260925092500
//
// This is the supported way to fix a migration that has been applied but is
// still in development: it drops the history row and replays the file, so the
// recorded statements match the file and the schema matches the file. It is the
// controlled equivalent of `supabase migration repair` followed by a re-apply,
// which is not available here because the Supabase CLI cannot be used against
// this project (see README, "Migration history").
//
// Two guards, because replaying a migration is only safe when nothing was built
// on top of it:
//
//   * the version must already be recorded, and
//   * no later migration may be recorded, since those were applied on top of
//     this one and would now be resting on a schema that never existed.
//
// --force overrides the second guard for the case where you know the later
// migrations are unaffected.
//
// Never use this on a migration that has been deployed anywhere real. Correcting
// deployed history means a new forward migration, not a rewrite.
import {
  applyMigration,
  connect,
  describeMigrationError,
  listMigrations,
} from "./lib/db.mjs";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");

if (!version) {
  console.error("Usage: npm run db:migration-redo -- <version> [--force]");
  process.exit(2);
}

const migration = listMigrations().find((m) => m.version === version);
if (!migration) {
  console.error(`No file in supabase/migrations starts with ${version}.`);
  process.exit(2);
}

const client = await connect();

try {
  await client.connect();

  const recorded = await client.query(
    "select 1 from supabase_migrations.schema_migrations where version = $1",
    [version],
  );
  if (recorded.rowCount === 0) {
    console.error(
      `${version} is not recorded as applied. Use npm run db:migrate instead -- ` +
        `this command exists to correct history, not to create it.`,
    );
    process.exitCode = 1;
  } else {
    const later = await client.query(
      "select version, name from supabase_migrations.schema_migrations where version > $1 order by version",
      [version],
    );
    if (later.rowCount > 0 && !force) {
      console.error(
        `refusing: ${later.rowCount} later migration(s) are recorded on top of ${version}:\n` +
          later.rows.map((r) => `  ${r.version}  ${r.name ?? ""}`).join("\n") +
          `\n\nRe-applying ${version} changes the schema they were built against. ` +
          `Re-run with --force only if you know they are unaffected.`,
      );
      process.exitCode = 1;
    } else {
      console.log(`re-applying ${migration.file}`);
      await client.query("delete from supabase_migrations.schema_migrations where version = $1", [
        version,
      ]);
      const started = Date.now();
      try {
        await applyMigration(client, migration);
        console.log(`OK    ${migration.file}  (${Date.now() - started}ms)`);
      } catch (error) {
        console.error("re-apply failed; the history row is gone, re-run db:migrate to restore it");
        for (const line of describeMigrationError(error).split("\n")) console.error(line);
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  console.error(`migration redo failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
