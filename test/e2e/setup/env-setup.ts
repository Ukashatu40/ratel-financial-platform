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
process.env.OBJECT_STORAGE_ENDPOINT = state.minioEndpoint;
process.env.OBJECT_STORAGE_BUCKET = 'e2e-test-attachments';
process.env.OBJECT_STORAGE_ACCESS_KEY = state.minioAccessKey;
process.env.OBJECT_STORAGE_SECRET_KEY = state.minioSecretKey;
process.env.CLAMAV_HOST = state.clamavHost;
process.env.CLAMAV_PORT = String(state.clamavPort);

// Rate limiting (rate-limit.module.ts) is real here, not mocked — same
// philosophy as everything else in this harness — but every e2e spec file
// shares ONE Redis instance for the whole suite (global-setup.ts), and
// every supertest request appears to come from the same loopback IP. A
// production-realistic auth limit (5 per 15 minutes) would make the
// second spec file's first `loginAs()` call 429 immediately. Set
// deliberately generous here so the guard/Redis/decorator wiring is
// genuinely exercised without throttling the test run itself.
// rate-limiting.e2e.spec.ts overrides RATE_LIMIT_AUTH_* down to a real
// value for its own file only, to prove the strict path actually works.
process.env.RATE_LIMIT_DEFAULT_LIMIT = '100000';
process.env.RATE_LIMIT_DEFAULT_TTL_MS = '60000';
process.env.RATE_LIMIT_AUTH_LIMIT = '100000';
process.env.RATE_LIMIT_AUTH_TTL_MS = '60000';
process.env.RATE_LIMIT_REPORTS_LIMIT = '100000';
process.env.RATE_LIMIT_REPORTS_TTL_MS = '60000';
