// test/e2e/setup/jest-setup-after-env.ts
import { disconnectE2eDb } from './e2e-db-helper';
import { afterAll } from '@jest/globals';

afterAll(async () => {
  await disconnectE2eDb();
});
