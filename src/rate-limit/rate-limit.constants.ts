// src/rate-limit/rate-limit.constants.ts
//
// Phase 9.6: per-IP rate limiting, stricter on the auth endpoints
// (credential-stuffing surface) and reporting/export endpoints (bulk-
// exfiltration surface) than on ordinary resource endpoints.
//
// RATE_LIMIT_DEFAULTS is the single source of truth for the numeric
// defaults — env.schema.ts's Zod `.default(...)` calls import these same
// constants rather than restating the numbers, so there is exactly one
// place that says what "5 login attempts per 15 minutes" means.
export const RATE_LIMIT_DEFAULTS = {
  DEFAULT_LIMIT: 120,
  DEFAULT_TTL_MS: 60_000,
  AUTH_LIMIT: 5,
  AUTH_TTL_MS: 900_000, // 15 minutes
  REPORTS_LIMIT: 20,
  REPORTS_TTL_MS: 60_000,
} as const;

/**
 * Parses a positive integer env var, falling back when unset/invalid.
 * Exported so its parsing rules (integer, > 0, else fallback) are asserted
 * directly by a unit test rather than only exercised incidentally.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * `@Throttle()` route-level overrides (auth.controller.ts,
 * reports.controller.ts) are decorators evaluated at class-definition
 * time — before Nest's DI container exists, so there is no ConfigService
 * to inject here. `@nestjs/throttler` supports a `Resolvable<number>`
 * (a plain function, called per-request) specifically for cases like this.
 *
 * Reading `process.env` directly here — rather than through ConfigService
 * — is safe, not a second source of truth: `validateEnv()` (env.schema.ts)
 * already ran at boot and would have exited the process if these vars were
 * malformed, so by the time any request reaches a route, `process.env` is
 * guaranteed to satisfy the same schema RateLimitModule's ConfigService-
 * backed 'default' throttler reads. Same value, two unavoidable read paths
 * for the same DI constraint — not two different answers to the same
 * question (the #22/#37/#47 drift risk this codebase explicitly guards
 * against elsewhere).
 */
export const authThrottle = {
  limit: (): number => envInt('RATE_LIMIT_AUTH_LIMIT', RATE_LIMIT_DEFAULTS.AUTH_LIMIT),
  ttl: (): number => envInt('RATE_LIMIT_AUTH_TTL_MS', RATE_LIMIT_DEFAULTS.AUTH_TTL_MS),
};

export const reportsThrottle = {
  limit: (): number => envInt('RATE_LIMIT_REPORTS_LIMIT', RATE_LIMIT_DEFAULTS.REPORTS_LIMIT),
  ttl: (): number => envInt('RATE_LIMIT_REPORTS_TTL_MS', RATE_LIMIT_DEFAULTS.REPORTS_TTL_MS),
};
