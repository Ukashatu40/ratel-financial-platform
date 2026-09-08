// test/unit/rate-limit/rate-limit.constants.spec.ts
import { describe, expect, it, afterEach } from '@jest/globals';
import {
  envInt,
  authThrottle,
  reportsThrottle,
  RATE_LIMIT_DEFAULTS,
} from '../../../src/rate-limit/rate-limit.constants';

/**
 * authThrottle/reportsThrottle read `process.env` directly (see the comment
 * in rate-limit.constants.ts for why — @Throttle()'s route-level override
 * is a decorator, evaluated before Nest's DI container exists, so there is
 * no ConfigService to inject). This spec pins that parsing behaviour
 * directly, since nothing else in the suite exercises these functions —
 * auth.controller.ts and reports.controller.ts only ever pass them by
 * reference, never call them at decoration time.
 */
describe('rate-limit.constants', () => {
  const ENV_KEYS = [
    'RATE_LIMIT_AUTH_LIMIT',
    'RATE_LIMIT_AUTH_TTL_MS',
    'RATE_LIMIT_REPORTS_LIMIT',
    'RATE_LIMIT_REPORTS_TTL_MS',
    'RATE_LIMIT_TEST_KEY',
  ] as const;

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  describe('envInt', () => {
    it('falls back when the env var is unset', () => {
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(42);
    });

    it('parses a valid positive integer string', () => {
      process.env.RATE_LIMIT_TEST_KEY = '17';
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(17);
    });

    it('falls back on a non-numeric value rather than returning NaN', () => {
      process.env.RATE_LIMIT_TEST_KEY = 'not-a-number';
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(42);
    });

    it('falls back on zero and negative values — a limit of 0 would block everything', () => {
      process.env.RATE_LIMIT_TEST_KEY = '0';
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(42);

      process.env.RATE_LIMIT_TEST_KEY = '-5';
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(42);
    });

    it('falls back on a non-integer value', () => {
      process.env.RATE_LIMIT_TEST_KEY = '3.5';
      expect(envInt('RATE_LIMIT_TEST_KEY', 42)).toBe(42);
    });
  });

  describe('authThrottle / reportsThrottle', () => {
    it('use RATE_LIMIT_DEFAULTS when unset', () => {
      expect(authThrottle.limit()).toBe(RATE_LIMIT_DEFAULTS.AUTH_LIMIT);
      expect(authThrottle.ttl()).toBe(RATE_LIMIT_DEFAULTS.AUTH_TTL_MS);
      expect(reportsThrottle.limit()).toBe(RATE_LIMIT_DEFAULTS.REPORTS_LIMIT);
      expect(reportsThrottle.ttl()).toBe(RATE_LIMIT_DEFAULTS.REPORTS_TTL_MS);
    });

    it('read the current env value on every call, not a cached one — this is what lets an e2e spec override it per-file', () => {
      expect(authThrottle.limit()).toBe(RATE_LIMIT_DEFAULTS.AUTH_LIMIT);

      process.env.RATE_LIMIT_AUTH_LIMIT = '3';
      expect(authThrottle.limit()).toBe(3);

      delete process.env.RATE_LIMIT_AUTH_LIMIT;
      expect(authThrottle.limit()).toBe(RATE_LIMIT_DEFAULTS.AUTH_LIMIT);
    });
  });
});
