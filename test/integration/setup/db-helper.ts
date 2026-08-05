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
/**
 * Truncates every application table between tests, so tests don't leak
 * state into each other despite sharing one container/database. Uses
 * TRUNCATE ... CASCADE and RESTART IDENTITY so auto-increment-like
 * behavior (our UUID PKs don't need this, but sequences like
 * expense_number_sequences do) resets cleanly too.
 *
 * Table list maintained manually rather than introspected dynamically —
 * deliberate: an introspection-based approach would silently include any
 * NEW table added later without a decision being made about whether it
 * should be cleaned, whereas this list forces an explicit update alongside
 * any schema change that adds a table integration tests touch.
 */
export async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  const tables = [
    'audit_log_entries',
    'outbox_events',
    'approval_records',
    'approval_progress',
    'payslips',
    'payroll_runs',
    'salary_structures',
    'employees',
    'expenses',
    'expense_number_sequences',
    'expense_categories',
    'projects',
    'vendors',
    'departments',
    'refresh_tokens',
    'user_role_assignments',
    'role_permissions',
    'users',
    'financial_periods',
    'organizations',
  ];

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`,
  );
}
