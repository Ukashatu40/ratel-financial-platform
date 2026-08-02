// src/shared-kernel/audit/hash-chain.util.ts
import { createHash } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface HashableEntry {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  correlationId: string;
  createdAt: Date;
}

/**
 * Each entry's hash is a function of the previous entry's hash plus this
 * entry's own content — the standard hash-chain construction (reused
 * unmodified from BED-6D). Tampering with any historical row breaks every
 * subsequent hash, making tampering detectable by recomputing the chain,
 * not preventable outright — detection, not prevention, is the actual
 * guarantee this gives.
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
