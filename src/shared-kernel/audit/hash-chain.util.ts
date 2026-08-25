// src/shared-kernel/audit/hash-chain.util.ts
import { createHash } from 'crypto';
import { canonicalStringify } from '../serialization/canonical-json';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Hash scheme version written to `audit_log_entries.hash_version`.
 *
 * v1 covered only who/what/when/action. v2 additionally covers `oldValue`,
 * `newValue` and `reason` — see computeEntryHashV2. The column defaults to 1, so
 * rows written before this existed are correctly labelled rather than silently
 * assumed to be v2, and a verifier can pick the right function per row instead of
 * reporting every historical entry as tampered.
 */
export const CURRENT_HASH_VERSION = 2;

export interface HashableEntry {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  correlationId: string;
  createdAt: Date;
}

/** v2 adds the payload fields v1 left unprotected. */
export interface HashableEntryV2 extends HashableEntry {
  oldValue: unknown;
  newValue: unknown;
  reason?: string;
}

/**
 * Each entry's hash is a function of the previous entry's hash plus this
 * entry's own content — the standard hash-chain construction (reused
 * unmodified from BED-6D). Tampering with any historical row breaks every
 * subsequent hash, making tampering detectable by recomputing the chain,
 * not preventable outright — detection, not prevention, is the actual
 * guarantee this gives.
 *
 * IMPORTANT, and the reason v2 exists: that guarantee only ever covered the fields
 * listed in `HashableEntry`. `oldValue`, `newValue` and `reason` were NOT hashed, so
 * the entire substance of an audit entry could be rewritten without breaking the
 * chain. Kept unchanged here because rows already written were hashed this way, and
 * a verifier must be able to reproduce their hashes exactly.
 *
 * NOTE: no verifier exists in this codebase yet — nothing recomputes these hashes,
 * so the detection this comment describes is currently unimplemented. Tracked in
 * TECH_DEBT.
 */
export function computeEntryHash(prevHash: string, entry: HashableEntry): string {
  const payload = JSON.stringify({
    prevHash,
    organizationId: entry.organizationId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actorUserId: entry.actorUserId,
    correlationId: entry.correlationId,
    createdAt: entry.createdAt.toISOString(),
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * v2: covers the audit payload as well as its metadata, so the diff written to
 * `old_value` (TECH_DEBT #8) is tamper-evident rather than being the most
 * forgery-worthy field in the row and the only unprotected one.
 *
 * Uses `canonicalStringify`, NOT `JSON.stringify`, and that is load-bearing rather
 * than stylistic. `old_value`/`new_value` are `jsonb`, which does not preserve key
 * insertion order — so a verifier reading the row back would serialize the same data
 * into a different string and compute a different hash. Sorting keys on both sides
 * is what makes the hash reproducible from the database. Proven by an integration
 * test that recomputes the hash from a row read back out of real Postgres; a unit
 * test on an in-memory object could not detect this class of bug at all.
 */
export function computeEntryHashV2(prevHash: string, entry: HashableEntryV2): string {
  const payload = canonicalStringify({
    prevHash,
    organizationId: entry.organizationId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actorUserId: entry.actorUserId,
    correlationId: entry.correlationId,
    createdAt: entry.createdAt.toISOString(),
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    // Normalized to null so an absent reason and an explicitly-null one hash
    // identically — jsonb cannot distinguish them once stored either.
    reason: entry.reason ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}
