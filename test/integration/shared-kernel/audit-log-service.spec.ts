// test/integration/shared-kernel/audit-log-service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../setup/db-helper';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UNIT_OF_WORK } from '../../../src/shared-kernel/unit-of-work/unit-of-work.port';
import { PrismaUnitOfWork } from '../../../src/shared-kernel/unit-of-work/prisma-unit-of-work';
import { AuditLogService } from '../../../src/shared-kernel/audit/audit-log.service';
import {
  CURRENT_HASH_VERSION,
  GENESIS_HASH,
  computeEntryHashV2,
} from '../../../src/shared-kernel/audit/hash-chain.util';
import { expect, it, describe, beforeAll, beforeEach, afterAll } from '@jest/globals';

describe('AuditLogService (integration) — hash-chain atomicity under concurrency', () => {
  let prisma: PrismaClient;
  let service: AuditLogService;

  beforeAll(async () => {
    prisma = getTestPrismaClient();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
        AuditLogService,
      ],
    }).compile();
    service = moduleRef.get(AuditLogService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function buildEntry(i: number) {
    return {
      organizationId: 'org-1',
      entityType: 'Expense',
      entityId: `exp-${i}`,
      action: 'ExpenseDrafted',
      actorUserId: 'user-1',
      newValue: { index: i },
      correlationId: `corr-${i}`,
      source: 'api',
    };
  }

  it('produces a genuinely unbroken chain under 20 concurrent writers — the actual proof the advisory lock works', async () => {
    // Before the fix, this is EXACTLY the scenario that would corrupt the
    // chain: 20 concurrent record() calls, all racing to read "the last
    // hash" before any of them commits their insert. Without serialization,
    // several would read the SAME prevHash and produce entries that don't
    // actually chain together, even though each individual entry's hash
    // would still be internally "valid" (computed correctly from whatever
    // prevHash it happened to read).
    await Promise.all(Array.from({ length: 20 }, (_, i) => service.record(buildEntry(i))));

    const entries = await prisma.auditLogEntry.findMany({ orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(20);

    // The real test: walk the chain and confirm EVERY entry's prevHash
    // matches the PREVIOUS entry's entryHash exactly, with the very first
    // entry chaining from the genesis hash. Any race would produce at
    // least one broken link here — this can't pass by accident.
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash).toBe(entries[i - 1].entryHash);
    }
  });

  it('every entryHash is unique — no two concurrent writers produced the same hash', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => service.record(buildEntry(i))));

    const entries = await prisma.auditLogEntry.findMany();
    const uniqueHashes = new Set(entries.map((e) => e.entryHash));
    expect(uniqueHashes.size).toBe(20);
  });

  it('a single record() call still works correctly (the lock does not break the non-concurrent path)', async () => {
    await service.record(buildEntry(1));
    const entries = await prisma.auditLogEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
  });

  it('two organizations writing concurrently produce two completely independent chains', async () => {
    const buildEntry = (org: string, i: number) => ({
      organizationId: org,
      entityType: 'Expense',
      entityId: `${org}-exp-${i}`,
      action: 'ExpenseDrafted',
      actorUserId: 'user-1',
      newValue: { index: i },
      correlationId: `${org}-corr-${i}`,
      source: 'api',
    });

    // Interleaved concurrent writes across TWO organizations — if the
    // per-org scoping in #7b's fix has any gap, this is exactly the
    // scenario that would produce a broken or cross-contaminated chain.
    const writes = [
      ...Array.from({ length: 10 }, (_, i) => service.record(buildEntry('org-A', i))),
      ...Array.from({ length: 10 }, (_, i) => service.record(buildEntry('org-B', i))),
    ];
    await Promise.all(writes);

    const orgAEntries = await prisma.auditLogEntry.findMany({
      where: { organizationId: 'org-A' },
      orderBy: { createdAt: 'asc' },
    });
    const orgBEntries = await prisma.auditLogEntry.findMany({
      where: { organizationId: 'org-B' },
      orderBy: { createdAt: 'asc' },
    });

    expect(orgAEntries).toHaveLength(10);
    expect(orgBEntries).toHaveLength(10);

    // Each org's chain must be internally unbroken, independently...
    expect(orgAEntries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < orgAEntries.length; i++)
      expect(orgAEntries[i].prevHash).toBe(orgAEntries[i - 1].entryHash);

    expect(orgBEntries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < orgBEntries.length; i++)
      expect(orgBEntries[i].prevHash).toBe(orgBEntries[i - 1].entryHash);

    // ...and neither chain's hashes appear anywhere in the OTHER org's
    // chain — the actual disclosure concern TECH_DEBT #7b was about.
    const orgAHashes = new Set(orgAEntries.map((e) => e.entryHash));
    const orgBHashes = new Set(orgBEntries.map((e) => e.entryHash));
    const overlap = [...orgAHashes].filter((h) => orgBHashes.has(h));
    expect(overlap).toHaveLength(0);
  });

  // --- TECH_DEBT #8 / hash v2 ---

  it('new rows are hashVersion 2, and oldValue/newValue are persisted (and no longer NULL)', async () => {
    await service.record({
      organizationId: 'org-1',
      entityType: 'FinancialPeriod',
      entityId: 'period-1',
      action: 'PeriodClosed',
      actorUserId: 'user-1',
      oldValue: { status: 'open', closedById: null },
      newValue: { organizationId: 'org-1', status: 'closed', closedById: 'user-1' },
      correlationId: 'corr-hashv2',
      source: 'api',
    });

    const row = await prisma.auditLogEntry.findFirstOrThrow({
      where: { correlationId: 'corr-hashv2' },
    });

    expect(row.hashVersion).toBe(CURRENT_HASH_VERSION);
    expect(row.oldValue).toMatchObject({ status: 'open' });
    expect(row.newValue).toMatchObject({ status: 'closed' });
  });

  it('recomputing the v2 hash from the row read back out of Postgres reproduces entryHash — the jsonb key-order proof', async () => {
    // THE load-bearing test for the canonical serialization in hash v2.
    //
    // old_value/new_value are jsonb. Postgres does not preserve key insertion order:
    // it stores a parsed representation and returns keys in the database's own order.
    // So JSON.stringify(row.newValue) will generally NOT equal
    // JSON.stringify(originalObject), even though they are the same data. If v2 had
    // hashed with plain JSON.stringify, this assertion would fail — and would keep
    // failing for every row ever written, because a verifier recomputing the hash
    // from the DB would get a different string.
    //
    // A unit test on an in-memory object CANNOT catch this: the object never goes
    // through jsonb, so key order is whatever the test wrote. This is the only layer
    // that can prove it, which is why it lives here rather than as a mock.
    const newValue = {
      organizationId: 'org-1',
      // Several keys that may be reordered by jsonb, including a nested object.
      status: 'closed',
      closedById: 'user-1',
      reason: 'Late vendor invoice',
      changes: {
        status: { from: 'open', to: 'closed' },
        closedById: { from: null, to: 'user-1' },
      },
    };
    const oldValue = { status: 'open', closedById: null };

    await service.record({
      organizationId: 'org-1',
      entityType: 'FinancialPeriod',
      entityId: 'period-1',
      action: 'PeriodClosed',
      actorUserId: 'user-1',
      oldValue,
      newValue,
      reason: 'Late vendor invoice',
      correlationId: 'corr-roundtrip',
      source: 'api',
    });

    const row = await prisma.auditLogEntry.findFirstOrThrow({
      where: { correlationId: 'corr-roundtrip' },
    });

    // Recomputed entirely from what the database returned — NOT from the local
    // objects above. If this equals the stored hash, the serialization in the hash
    // function and the serialization jsonb applies are compatible.
    const recomputed = computeEntryHashV2(row.prevHash, {
      organizationId: row.organizationId,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      actorUserId: row.actorUserId,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
      oldValue: row.oldValue,
      newValue: row.newValue,
      reason: row.reason ?? undefined,
    });

    expect(recomputed).toBe(row.entryHash);
  });

  it('the chain stays v2-consistent under concurrent writers', async () => {
    // 20 concurrent v2 writes: the chain must still be unbroken (the advisory lock
    // serializes prevHash reads regardless of hash scheme), and every new row must
    // be hashVersion 2 so a future verifier picks the right function for each row.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        service.record({
          organizationId: 'org-1',
          entityType: 'Expense',
          entityId: `exp-v2-${i}`,
          action: 'ExpenseDrafted',
          actorUserId: 'user-1',
          newValue: { index: i },
          correlationId: `corr-v2-${i}`,
          source: 'api',
        }),
      ),
    );

    const entries = await prisma.auditLogEntry.findMany({
      where: { organizationId: 'org-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries).toHaveLength(20);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash).toBe(entries[i - 1].entryHash);
    }
    expect(entries.every((e) => e.hashVersion === CURRENT_HASH_VERSION)).toBe(true);
  });
});
