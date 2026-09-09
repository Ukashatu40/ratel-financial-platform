// src/config/cors.config.ts
import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * Parses CORS_ORIGINS into the shape @fastify/cors's `origin` option wants.
 * - unset/empty -> false (CORS fully disabled — no Access-Control-Allow-Origin
 *   is ever sent, so a browser page on a different origin cannot read
 *   responses at all). This is the safe default: explicit opt-in per
 *   environment, matching this codebase's posture elsewhere (KMS,
 *   FIELD_ENCRYPTION_MASTER_KEY, JWT secrets — nothing permissive by
 *   default, an operator must configure production themselves).
 * - "*" -> true (reflect any origin — dev convenience). @fastify/cors
 *   still won't set Access-Control-Allow-Credentials in this case, which
 *   is correct per the CORS spec: wildcard origin + credentials is
 *   disallowed by browsers regardless of what a server sends.
 * - "https://a.com, https://b.com" -> ['https://a.com', 'https://b.com']
 *   — exact match against the browser's Origin header. No subdomain/
 *   wildcard pattern matching, deliberately: an explicit allowlist is
 *   easier to reason about and audit than a pattern that might match more
 *   than intended.
 */
export function parseCorsOrigins(raw: string | undefined): boolean | string[] {
  if (!raw || raw.trim().length === 0) return false;

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) return false;
  if (origins.includes('*')) return true;

  return origins;
}

/**
 * This API is bearer-token-only, never cookie-based (Phase 9.2/9.5 —
 * "CSRF is largely moot for a stateless bearer-token JSON API with no
 * cookie-based session"), so Access-Control-Allow-Credentials isn't
 * needed for the Authorization header itself — a cross-origin fetch can
 * send `Authorization` without `credentials: 'include'`. Defaults to
 * false for that reason; CORS_CREDENTIALS exists as an explicit override
 * in case a future refresh-token-via-cookie flow needs it.
 */
export function buildCorsOptions(
  rawOrigins: string | undefined,
  credentials: boolean,
): FastifyCorsOptions {
  return {
    origin: parseCorsOrigins(rawOrigins),
    credentials,
  };
}
