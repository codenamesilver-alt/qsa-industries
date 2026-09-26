// Runs the pgTAP suites against the target database.
//
//   npm run db:test
//   PGDATABASE=some_other_db npm run db:test
//
// Every suite runs inside an implicit transaction that is rolled back, so the
// suites leave no rows behind. They do still burn sequence values, because
// nextval is not transactional -- that is why the seed migration renumbers its
// invoices to a clean chronological range.
import { connect, runTests } from "./lib/db.mjs";

const client = await connect();

try {
  await client.connect();
  const { suites, failed } = await runTests(client);
  console.log(`\n${suites - failed}/${suites} test files passed`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(`could not run tests: ${error.message}`);
  process.exitCode = 2;
} finally {
  await client.end();
}
