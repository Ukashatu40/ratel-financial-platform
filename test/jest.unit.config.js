// test/jest.unit.config.js
const base = require('./jest.base.config');

module.exports = {
  ...base,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  // Capped deliberately (TECH_DEBT #28). Unbounded, Jest uses cores-1
  // workers — 15 on a 16-core machine — and 15 concurrent ts-jest TypeScript
  // compilations contend badly enough that some workers miss Jest's teardown
  // grace period and get force-exited, producing the "worker process has
  // failed to exit gracefully" warning that used to close every unit run.
  //
  // This is NOT masking a handle leak: --detectOpenHandles reports none, no
  // single spec reproduces the warning in isolation, and `src/` contains no
  // timers at all. It's CPU contention, and the measurement says so — the
  // full suite runs in ~11s at 50% and ~25s unbounded, so the cap is a 2.3x
  // speedup that happens to also fix the warning, not a workaround with a
  // cost. A percentage rather than a fixed number so a smaller CI box
  // doesn't end up serialized.
  maxWorkers: '50%',
  collectCoverageFrom: [
    'src/**/domain/**/*.ts',
    'src/shared-kernel/**/*.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
};
