// test/integration/shared-kernel/audit-log-service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../setup/db-helper';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UNIT_OF_WORK } from '../../../src/shared-kernel/unit-of-work/unit-of-work.port';
import { PrismaUnitOfWork } from '../../../src/shared-kernel/unit-of-work/prisma-unit-of-work';
import { AuditLogService } from '../../../src/shared-kernel/audit/audit-log.service';
import { GENESIS_HASH } from '../../../src/shared-kernel/audit/hash-chain.util';
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
});
