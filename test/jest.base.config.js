// test/jest.base.config.js
/** Shared base — each type-specific config extends this. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '../',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@shared-kernel/(.*)$': '<rootDir>/src/shared-kernel/$1',
    '^@contexts/(.*)$': '<rootDir>/src/contexts/$1',
    '^@integration/(.*)$': '<rootDir>/src/integration/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
