// test/integration/audit-log/chain-verifier.service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../setup/db-helper';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UNIT_OF_WORK } from '../../../src/shared-kernel/unit-of-work/unit-of-work.port';
import { PrismaUnitOfWork } from '../../../src/shared-kernel/unit-of-work/prisma-unit-of-work';
import { AuditLogService } from '../../../src/shared-kernel/audit/audit-log.service';
import { ChainVerifierService } from '../../../src/audit-log/application/chain-verifier.service';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

describe('ChainVerifierService (integration) — real jsonb round-trip', () => {
  let prisma: PrismaClient;
  let auditLog: AuditLogService;
  let verifier: ChainVerifierService;

  beforeAll(async () => {
    prisma = getTestPrismaClient();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
        AuditLogService,
        ChainVerifierService,
      ],
    }).compile();
    auditLog = moduleRef.get(AuditLogService);
    verifier = moduleRef.get(ChainVerifierService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies a genuine v2 chain written through AuditLogService and read back through real jsonb', async () => {
    // A realistic payload shape, with keys in an order deliberately different
    // from how canonicalStringify would sort them — this is precisely the case
    // that would fail if the verifier re-serialized without sorting (#8's own
    // falsification bug, being guarded against here for the read side too).
    await auditLog.record({
      organizationId: 'org-1',
      entityType: 'FinancialPeriod',
      entityId: 'period-1',
      action: 'PeriodReopened',
      actorUserId: 'user-1',
      oldValue: { zebra: 'z', apple: 'a', status: 'closed' },
      newValue: { status: 'reopened', reason: 'correction needed' },
      reason: 'correction needed',
      correlationId: 'corr-1',
      source: 'api',
    });

    await auditLog.record({
      organizationId: 'org-1',
      entityType: 'FinancialPeriod',
      entityId: 'period-1',
      action: 'PeriodClosed',
      actorUserId: 'user-2',
      oldValue: { status: 'reopened' },
      newValue: { status: 'closed' },
      correlationId: 'corr-2',
      source: 'api',
    });

    const result = await verifier.verify('org-1');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(2);
  });

  it('detects a real tampered row after a genuine round-trip through Postgres', async () => {
    await auditLog.record({
      organizationId: 'org-1',
      entityType: 'Expense',
      entityId: 'exp-1',
      action: 'ExpenseApproved',
      actorUserId: 'user-1',
      newValue: { status: 'approved' },
      correlationId: 'corr-1',
      source: 'api',
    });

    // Simulate a direct DB edit — the exact threat model the hash chain exists
    // to detect (an app bug or a compromised connection rewriting a row
    // directly, bypassing AuditLogService entirely).
    await prisma.auditLogEntry.updateMany({
      where: { entityId: 'exp-1' },
      data: { action: 'ExpenseRejected' }, // content changed, entryHash left stale
    });

    const result = await verifier.verify('org-1');

    expect(result.valid).toBe(false);
    expect(result.firstMismatchReason).toBe('content');
  });

  it('two organizations verify independently — tampering in one does not affect the other', async () => {
    await auditLog.record({
      organizationId: 'org-A',
      entityType: 'Expense',
      entityId: 'exp-a1',
      action: 'ExpenseDrafted',
      actorUserId: 'user-1',
      newValue: {},
      correlationId: 'corr-a1',
      source: 'api',
    });
    await auditLog.record({
      organizationId: 'org-B',
      entityType: 'Expense',
      entityId: 'exp-b1',
      action: 'ExpenseDrafted',
      actorUserId: 'user-1',
      newValue: {},
      correlationId: 'corr-b1',
      source: 'api',
    });

    await prisma.auditLogEntry.updateMany({
      where: { entityId: 'exp-a1' },
      data: { action: 'TAMPERED' },
    });

    const resultA = await verifier.verify('org-A');
    const resultB = await verifier.verify('org-B');

    expect(resultA.valid).toBe(false);
    expect(resultB.valid).toBe(true); // org-B's independent chain, per #7b, is untouched
  });
});
