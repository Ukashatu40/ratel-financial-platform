// test/e2e/setup/e2e-db-helper.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const STATE_FILE = join(__dirname, '.e2e-state.json');

let sharedClient: PrismaClient | null = null;
let sharedPool: Pool | null = null;

/**
 * Separate PrismaClient/pool from whatever AppModule's own PrismaService
 * creates internally — this one exists purely for test-side setup
 * (seeding fixture data) and verification (checking DB state directly,
 * since not every mutation has a corresponding GET endpoint yet — see
 * TECH_DEBT.md's newly-flagged gap).
 */
export function getE2eDbClient(): PrismaClient {
  if (!sharedClient) {
    const { databaseUrl } = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const pool = new Pool({ connectionString: databaseUrl });
    pool.on('error', (err) => {
      if (err.message?.includes('terminating connection') || err.message?.includes('57P01')) return;
      // eslint-disable-next-line no-console
      console.warn('[e2e db pool] Idle client error:', err.message);
    });
    sharedPool = pool;
    sharedClient = new PrismaClient({ adapter: new PrismaPg(pool) });
  }
  return sharedClient;
}

let cachedTableNames: string[] | null = null;

export async function cleanE2eDatabase(): Promise<void> {
  const prisma = getE2eDbClient();

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

export async function disconnectE2eDb(): Promise<void> {
  if (sharedClient) {
    await sharedClient.$disconnect();
    sharedClient = null;
  }
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
  }
}
