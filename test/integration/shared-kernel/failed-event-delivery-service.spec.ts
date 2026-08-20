// test/integration/shared-kernel/failed-event-delivery-service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, cleanDatabase } from '../setup/db-helper';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { FailedEventDeliveryService } from '../../../src/shared-kernel/events/failed-event-delivery.service';
import { expect, it, describe, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * Integration rather than unit because the guarantee under test is the DB's:
 * the compound unique on (outbox_event_id, subscriber_name) is what makes
 * `upsert` collapse repeated failures onto one row. A fake Prisma client would
 * happily "pass" this while the real constraint did something else — the same
 * reason TECH_DEBT #7 insisted on a real integration test for the audit chain.
 */
describe('FailedEventDeliveryService (integration) — per-pair uniqueness', () => {
  let prisma: PrismaClient;
  let service: FailedEventDeliveryService;

  beforeAll(async () => {
    prisma = getTestPrismaClient();
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: prisma }, FailedEventDeliveryService],
    }).compile();
    service = moduleRef.get(FailedEventDeliveryService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const failure = (subscriberName: string, message: string) => ({
    subscriberName,
    error: new Error(message),
  });

  it('creates one row per failed subscriber, with attempts starting at 1', async () => {
    const recorded = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'db down'),
      failure('ExpenseReadModelProjector', 'db down'),
    ]);

    expect(recorded).toHaveLength(2);
    expect(recorded.every((r) => r.attempts === 1)).toBe(true);

    const rows = await prisma.failedEventDelivery.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending_retry')).toBe(true);
  });

  it('UPDATES the same row on a repeat failure for the same pair, rather than accumulating', async () => {
    const first = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'first failure'),
    ]);
    const second = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'second failure'),
    ]);

    expect(second[0].id).toBe(first[0].id); // same row
    expect(second[0].attempts).toBe(2);

    const rows = await prisma.failedEventDelivery.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].lastError).toBe('second failure'); // latest error wins
  });

  it('keeps the SAME subscriber on a DIFFERENT event as a separate row', async () => {
    await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'a'),
    ]);
    await service.recordFailures('outbox-2', 'ExpenseRejected', [
      failure('AuditSubscriber', 'b'),
    ]);

    expect(await prisma.failedEventDelivery.count()).toBe(2);
  });

  it('reopens a permanently-failed pair when it fails again', async () => {
    // A fresh failure for a pair previously given up on is a live problem
    // again, not a historical one.
    const [recorded] = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'first'),
    ]);
    await service.markPermanentlyFailed(recorded.id, new Error('gave up'));

    await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'happening again'),
    ]);

    const row = await prisma.failedEventDelivery.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(row.status).toBe('pending_retry');
    expect(row.attempts).toBe(2);
  });

  it('records a recovery, and bumps updatedAt off createdAt', async () => {
    const [recorded] = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'transient'),
    ]);

    await service.markRecovered(recorded.id);

    const row = await prisma.failedEventDelivery.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(row.status).toBe('recovered');
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
  });

  it('stringifies a non-Error rejection rather than storing "[object Object]"', async () => {
    // Promise.allSettled surfaces whatever was thrown, which is not always an
    // Error — the reason must still be readable by whoever investigates.
    const [recorded] = await service.recordFailures('outbox-1', 'ExpenseApproved', [
      { subscriberName: 'AuditSubscriber', error: 'a bare string rejection' },
    ]);

    const row = await prisma.failedEventDelivery.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(row.lastError).toBe('a bare string rejection');
  });
});
