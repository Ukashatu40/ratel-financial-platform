// test/integration/setup/global-setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join(__dirname, '.testcontainer-state.json');

/**
 * Starts ONE Postgres container for the entire integration test run,
 * applies real Prisma migrations against it (not a schema push — this
 * exercises the actual migration files, catching drift between schema.prisma
 * and migrations/ that a push-based approach would hide), and persists the
 * connection string to a temp file individual test files read via
 * getTestDatabaseUrl() (db-helper.ts, below).
 *
 * One container for the whole run (not per-file) is a deliberate choice:
 * spinning up a fresh Postgres container per test file is slow and heavy
 * on a local machine running many suites. Isolation between tests is
 * handled instead by truncating tables between tests (cleanDatabase() in
 * db-helper.ts), not by container isolation.
 */
export default async function globalSetup(): Promise<void> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:15-alpine')
    .withDatabase('ratel_financial_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const databaseUrl = container.getConnectionUri();

  // eslint-disable-next-line no-console
  console.log(`\n[integration setup] Postgres container started: ${databaseUrl}`);

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  writeFileSync(
    STATE_FILE,
    JSON.stringify({ containerId: container.getId(), databaseUrl }),
    'utf8',
  );

  // Stash the container reference on the global object so globalTeardown
  // (a SEPARATE process context in Jest) can still stop it — Jest's
  // globalSetup/globalTeardown don't share memory, only the state file,
  // so we re-attach by container ID in teardown rather than relying on
  // this reference directly.
  (globalThis as any).__TESTCONTAINER__ = container;
}
