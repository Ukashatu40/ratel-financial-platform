// test/unit/audit-log/chain-verifier.service.spec.ts
import { ChainVerifierService } from '../../../src/audit-log/application/chain-verifier.service';
import {
  computeEntryHash,
  computeEntryHashV2,
  GENESIS_HASH,
  HashableEntryV2,
} from '../../../src/shared-kernel/audit/hash-chain.util';
import { describe, it, expect } from '@jest/globals';

function buildFakePrisma(rows: any[]) {
  return { auditLogEntry: { findMany: jest.fn().mockResolvedValue(rows) } };
}

function baseFields(overrides: Partial<HashableEntryV2> = {}) {
  return {
    organizationId: 'org-1',
    entityType: 'Expense',
    entityId: 'exp-1',
    action: 'ExpenseDrafted',
    actorUserId: 'user-1',
    correlationId: 'corr-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

describe('ChainVerifierService', () => {
  it('reports valid with entriesChecked: 0 for an organization with no entries', async () => {
    const service = new ChainVerifierService(buildFakePrisma([]) as any);
    const result = await service.verify('org-1');
    expect(result).toEqual({
      organizationId: 'org-1',
      entriesChecked: 0,
      valid: true,
      firstMismatchId: null,
      firstMismatchReason: null,
      caveat: expect.any(String),
    });
  });

  it('verifies a genuinely valid v1 chain of 3 entries', async () => {
    const fields1 = baseFields({ entityId: 'exp-1' });
    const hash1 = computeEntryHash(GENESIS_HASH, fields1);
    const fields2 = baseFields({ entityId: 'exp-2' });
    const hash2 = computeEntryHash(hash1, fields2);
    const fields3 = baseFields({ entityId: 'exp-3' });
    const hash3 = computeEntryHash(hash2, fields3);

    const rows = [
      {
        id: 'row-1',
        ...fields1,
        prevHash: GENESIS_HASH,
        entryHash: hash1,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
      {
        id: 'row-2',
        ...fields2,
        prevHash: hash1,
        entryHash: hash2,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
      {
        id: 'row-3',
        ...fields3,
        prevHash: hash2,
        entryHash: hash3,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
  });

  it('verifies a genuinely valid v2 chain, including oldValue/newValue/reason in the hash', async () => {
    const fields = baseFields({
      oldValue: { status: 'open' },
      newValue: { status: 'closed' },
      reason: 'month end',
    });
    const hash = computeEntryHashV2(GENESIS_HASH, fields);

    const rows = [
      { id: 'row-1', ...fields, prevHash: GENESIS_HASH, entryHash: hash, hashVersion: 2 },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(true);
  });

  it('handles a mixed v1-then-v2 chain — each row verified under its own scheme', async () => {
    const fields1 = baseFields({ entityId: 'exp-1' });
    const hash1 = computeEntryHash(GENESIS_HASH, fields1);
    const fields2 = baseFields({
      entityId: 'exp-2',
      oldValue: null,
      newValue: { x: 1 },
      reason: undefined,
    });
    const hash2 = computeEntryHashV2(hash1, fields2);

    const rows = [
      {
        id: 'row-1',
        ...fields1,
        prevHash: GENESIS_HASH,
        entryHash: hash1,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
      { id: 'row-2', ...fields2, prevHash: hash1, entryHash: hash2, hashVersion: 2, reason: null },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(true);
  });

  it('detects CONTENT tampering: entryHash does not match recomputed content', async () => {
    const fields = baseFields();
    const hash = computeEntryHash(GENESIS_HASH, fields);

    const rows = [
      // action was changed after the hash was computed — entryHash is now stale
      {
        id: 'row-1',
        ...fields,
        action: 'ExpenseApproved',
        prevHash: GENESIS_HASH,
        entryHash: hash,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(false);
    expect(result.firstMismatchId).toBe('row-1');
    expect(result.firstMismatchReason).toBe('content');
  });

  it("detects LINKAGE tampering: prevHash does not match the prior row's actual entryHash", async () => {
    const fields1 = baseFields({ entityId: 'exp-1' });
    const hash1 = computeEntryHash(GENESIS_HASH, fields1);
    const fields2 = baseFields({ entityId: 'exp-2' });
    // row-2's prevHash correctly matches hash1 at hash-time, but we corrupt it below
    const hash2 = computeEntryHash(hash1, fields2);

    const rows = [
      {
        id: 'row-1',
        ...fields1,
        prevHash: GENESIS_HASH,
        entryHash: hash1,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
      // prevHash rewritten to something that doesn't match row-1's real entryHash —
      // row-2's OWN content+hash are still internally consistent (content check
      // would pass), only the LINK to row-1 is broken.
      {
        id: 'row-2',
        ...fields2,
        prevHash: 'a'.repeat(64),
        entryHash: hash2,
        hashVersion: 1,
        oldValue: null,
        newValue: {},
        reason: null,
      },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(false);
    expect(result.firstMismatchId).toBe('row-2');
    expect(result.firstMismatchReason).toBe('linkage');
  });

  it('flags an unrecognized hashVersion rather than guessing which scheme to apply', async () => {
    const rows = [
      {
        id: 'row-1',
        ...baseFields(),
        prevHash: GENESIS_HASH,
        entryHash: 'irrelevant',
        hashVersion: 3,
        oldValue: null,
        newValue: {},
        reason: null,
      },
    ];

    const service = new ChainVerifierService(buildFakePrisma(rows) as any);
    const result = await service.verify('org-1');

    expect(result.valid).toBe(false);
    expect(result.firstMismatchReason).toBe('unrecognized-version');
  });

  it('every result includes the caveat, valid or not', async () => {
    const service = new ChainVerifierService(buildFakePrisma([]) as any);
    const result = await service.verify('org-1');
    expect(result.caveat).toContain('cannot prove no entries are missing');
  });
});
