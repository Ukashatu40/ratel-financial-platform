// test/jest.unit.config.js
const base = require('./jest.base.config');

module.exports = {
  ...base,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/domain/**/*.ts',
    'src/shared-kernel/**/*.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
};
