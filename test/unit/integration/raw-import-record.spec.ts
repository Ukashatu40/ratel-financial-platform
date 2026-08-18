// test/unit/integration/raw-import-record.spec.ts
import { computeSourceRecordHash } from '../../../src/integration/domain/raw-import-record';
import { describe, it, expect } from '@jest/globals';

describe('computeSourceRecordHash', () => {
  it('produces the SAME hash for identical row content', () => {
    const row = { department: 'Engineering', category: 'Cloud', amountMinorUnits: '5000' };
    expect(computeSourceRecordHash(row)).toBe(computeSourceRecordHash({ ...row }));
  });

  it('produces the SAME hash regardless of key order (this is what makes replay-safety reliable)', () => {
    const rowA = { department: 'Engineering', category: 'Cloud', amountMinorUnits: '5000' };
    const rowB = { amountMinorUnits: '5000', department: 'Engineering', category: 'Cloud' };
    expect(computeSourceRecordHash(rowA)).toBe(computeSourceRecordHash(rowB));
  });

  it('produces a DIFFERENT hash for different content', () => {
    const rowA = { department: 'Engineering', amountMinorUnits: '5000' };
    const rowB = { department: 'Engineering', amountMinorUnits: '5001' };
    expect(computeSourceRecordHash(rowA)).not.toBe(computeSourceRecordHash(rowB));
  });
});
