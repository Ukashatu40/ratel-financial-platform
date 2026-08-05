// test/jest.e2e.config.js
const base = require('./jest.base.config');

module.exports = {
  ...base,
  displayName: 'e2e',
  testMatch: ['<rootDir>/test/e2e/**/*.spec.ts'],
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/e2e/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/setup/global-teardown.ts',
  setupFiles: ['<rootDir>/test/e2e/setup/env-setup.ts'], // runs BEFORE test framework/module imports
  setupFilesAfterEnv: ['<rootDir>/test/e2e/setup/jest-setup-after-env.ts'],
  maxWorkers: 1,
  coverageDirectory: '<rootDir>/coverage/e2e',
};
