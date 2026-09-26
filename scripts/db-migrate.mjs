// Applies pending migrations to the target database.
//
//   npm run db:migrate
//   PGDATABASE=some_other_db npm run db:migrate
//
// Migrations already recorded in supabase_migrations.schema_migrations are
// skipped. Each one runs inside a transaction together with its history row, so
// a failure leaves neither a partial schema change nor a false history entry.
import {
  applyMigration,
  appliedVersions,
  connect,
  describeMigrationError,
  ensureMigrationsTable,
  listMigrations,
} from "./lib/db.mjs";

const client = await connect();

try {
  await client.connect();
  await ensureMigrationsTable(client);

  const applied = await appliedVersions(client);
  const migrations = listMigrations();
  const pending = migrations.filter((migration) => !applied.has(migration.version));

  console.log(
    `target ${client.database} @ ${client.host}: ${applied.size} applied, ${pending.length} pending\n`,
  );

  for (const migration of pending) {
    const started = Date.now();
    try {
      await applyMigration(client, migration);
      console.log(`OK    ${migration.file}  (${Date.now() - started}ms)`);
    } catch (error) {
      console.log(`FAIL  ${migration.file}`);
      console.log(describeMigrationError(error));
      process.exitCode = 1;
      break;
    }
  }

  const total = (await appliedVersions(client)).size;
  console.log(`\n${client.database} now has ${total} recorded migrations`);
} finally {
  await client.end();
}
