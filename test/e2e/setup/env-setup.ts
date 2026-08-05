// test/e2e/setup/env-setup.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const STATE_FILE = join(__dirname, '.e2e-state.json');

/**
 * Registered via jest.e2e.config.js's `setupFiles` (NOT setupFilesAfterEnv —
 * this needs to run before ANY module, including AppModule, is imported/
 * compiled, since ConfigModule.forRoot()'s Zod validation reads process.env
 * at compile time). Each Jest test FILE runs in its own worker process with
 * its own process.env, so this must set these vars fresh per file — reading
 * from the state file globalSetup wrote, which DOES persist across
 * processes (unlike in-memory container references).
 */
const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = state.databaseUrl;
process.env.REDIS_HOST = state.redisHost;
process.env.REDIS_PORT = String(state.redisPort);
process.env.JWT_ACCESS_SECRET = 'e2e-test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret-at-least-32-characters-long';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL_DAYS = '7';
process.env.FIELD_ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 1).toString('base64'); // fixed, deterministic test key
