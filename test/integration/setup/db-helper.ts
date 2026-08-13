// test/integration/setup/db-helper.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const STATE_FILE = join(__dirname, '.testcontainer-state.json');

export function getTestDatabaseUrl(): string {
  const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  return databaseUrl;
}

let sharedClient: PrismaClient | null = null;
let sharedPool: Pool | null = null; // 👈 Cache the pool instance

/** One PrismaClient shared across all integration test files, pointed at
 * the single container from globalSetup. */
export function getTestPrismaClient(): PrismaClient {
  if (!sharedClient) {
    const pool = new Pool({ connectionString: getTestDatabaseUrl() });

    // REQUIRED by node-postgres: without this listener, an idle client
    // losing its connection (e.g. the container being stopped, a network
    // blip, Postgres restarting) emits an 'error' event with NO listener
    // attached — which Node treats as an unhandled exception and crashes
    // the whole process, exactly what happened here. This isn't optional
    // defensive code; it's the documented, required pattern for using
    // `pg.Pool` at all.
    pool.on('error', (err) => {
      // 1. Block logs if the pool object is already being garbage collected
      if (!sharedPool) return;

      // 2. Swallow the specific Docker teardown connection termination logs
      if (err.message?.includes('terminating connection') || err.message?.includes('57P01')) {
        return;
      }

      // eslint-disable-next-line no-console
      console.warn('[test db pool] Idle client error:', err.message);
    });

    const adapter = new PrismaPg(pool);
    sharedClient = new PrismaClient({ adapter });
    sharedPool = pool;
  }
  return sharedClient;
}

export async function disconnectTestDatabase(): Promise<void> {
  if (sharedClient) {
    await sharedClient.$disconnect();
    sharedClient = null;
  }
  if (sharedPool) {
    await sharedPool.end(); // 👈 Drain and close all sockets cleanly
    sharedPool = null;
  }
}
let cachedTableNames: string[] | null = null;

/**
 * Discovers actual tables via pg_tables rather than a hardcoded list —
 * closes TECH_DEBT #37/#36: a hardcoded list silently drifts out of sync
 * every time a new table is added (confirmed twice now — the original
 * build, then again during the ClamAV integration piece). Cached per test
 * FILE (Jest isolates modules per file by default), so this only queries
 * pg_tables once per file, not once per test, while still re-discovering
 * fresh on every new test run (a new migration between runs is picked up
 * automatically).
 */
export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  if (!cachedTableNames) {
    const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
    `;
    cachedTableNames = rows.map((r) => r.tablename);
  }

  if (cachedTableNames.length === 0) return;

  const tableList = cachedTableNames.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`);
}
