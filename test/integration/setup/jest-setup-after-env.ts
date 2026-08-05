// test/integration/setup/jest-setup-after-env.ts
import { disconnectTestDatabase } from './db-helper';
import { afterAll } from '@jest/globals';

/**
 * Registered via jest.integration.config.js's `setupFilesAfterEnv` — runs
 * once per test FILE (Jest isolates module registries per file by
 * default, so this correctly targets each file's own sharedClient/
 * sharedPool instance, not a global singleton across all files).
 *
 * This exists specifically so a new integration spec file never needs to
 * remember to call disconnectTestDatabase() manually — forgetting it
 * previously caused an unhandled pg.Pool error crash at teardown. Centralizing
 * it here makes that class of mistake structurally impossible going forward.
 */
afterAll(async () => {
  await disconnectTestDatabase();
});
