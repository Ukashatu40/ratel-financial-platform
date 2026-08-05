// test/jest.integration.config.js
const base = require('./jest.base.config');

module.exports = {
  ...base,
  displayName: 'integration',
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/integration/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/integration/setup/jest-setup-after-env.ts'],
  // Integration tests share ONE Postgres container/database (cleaned
  // between tests, not isolated by container) — running test FILES in
  // parallel would race on that shared state despite cleanDatabase()
  // running between individual tests within a file. Forcing serial
  // execution across files avoids that.
  maxWorkers: 1,
  coverageDirectory: '<rootDir>/coverage/integration',
};
