// src/integration/domain/raw-import-record.ts
import { createHash } from 'crypto';

export interface RawImportRecord {
  externalId: string;
  sourceRecordHash: string;
  departmentName: string;
  categoryName: string;
  vendorName?: string;
  amountMinorUnits: bigint;
  currency: string;
  expenseDate: Date;
  description?: string;
}

/**
 * Deterministic hash of the RAW row content (before any lookup/mapping),
 * used as the Inbox idempotency key (Phase 3.4). Hashing the raw fields
 * means the SAME row content always produces the SAME hash regardless of
 * how many times a job is replayed — this is what makes "did I already
 * process this exact row" answerable without depending on database state
 * that could itself be inconsistent after a partial failure.
 */
export function computeSourceRecordHash(row: Record<string, string>): string {
  const normalized = JSON.stringify(row, Object.keys(row).sort());
  return createHash('sha256').update(normalized).digest('hex');
}
