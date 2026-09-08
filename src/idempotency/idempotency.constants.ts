// src/idempotency/idempotency.constants.ts
//
// Phase 7.5: every mutating (POST/PATCH) endpoint accepts an optional
// `Idempotency-Key` header. First request with a given key executes and
// caches its response in Redis; a repeat with the same key replays the
// cached response instead of re-executing. Separate from bulk-operation
// idempotency (7.3, a body-level `idempotencyKey` field on
// POST /expenses/bulk-approve) and import-level idempotency (3.4, the
// Inbox pattern) — this is the general, header-driven mechanism.
export const IDEMPOTENCY_DEFAULTS = {
  // How long a completed response stays replayable.
  RESPONSE_TTL_MS: 86_400_000, // 24 hours
  // How long a key is held as "claimed but not yet complete" before it
  // self-heals — bounds how long a crashed request (claimed the key, then
  // the process died before completing or failing) can wedge a retry.
  LOCK_TTL_MS: 30_000,
} as const;

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';
export const IDEMPOTENCY_MAX_KEY_LENGTH = 255; // matches common practice (e.g. Stripe's own cap)
