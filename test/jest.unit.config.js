// test/jest.unit.config.js
const os = require('os');
const base = require('./jest.base.config');

const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;

/**
 * Capped deliberately (TECH_DEBT #28). Unbounded, Jest uses cores-1 workers —
 * 15 on a 16-core machine — and concurrent ts-jest TypeScript compilations
 * contend hard enough that a worker misses Jest's teardown grace period and is
 * force-exited, producing the "worker process has failed to exit gracefully"
 * warning.
 *
 * The trigger is a COLD ts-jest cache, which is what CI does on every run.
 * Measured on this 16-core machine, full unit suite:
 *
 *            cold cache        warm cache
 *   8 workers  37s, WARNS       14s, clean
 *   4 workers  16s, clean        9s, clean
 *
 * So a low cap is faster in BOTH states as well as quiet — fewer workers win
 * because ts-jest compilation is memory-bandwidth-bound, not CPU-bound.
 *
 * An absolute cap rather than a percentage, on purpose: a percentage silently
 * scales with the machine, which is how the first attempt at this (50%)
 * regressed the moment three spec files were added. A fixed small number can't
 * drift. Floored at 2 so a tiny CI box doesn't end up fully serialized.
 *
 * This is NOT masking a handle leak: --detectOpenHandles reports none, no
 * single spec reproduces the warning in isolation, and `src/` has no timers.
 */
const maxWorkers = Math.max(2, Math.min(4, cpus - 1));

module.exports = {
  ...base,
  displayName: 'unit',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  maxWorkers,
  collectCoverageFrom: [
    'src/**/domain/**/*.ts',
    'src/shared-kernel/**/*.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/unit',
};
