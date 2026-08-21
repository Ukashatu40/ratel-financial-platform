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

  const ORG = 'org-1';

  /**
   * Wraps `recordFailures` so its `organizationId` argument (added for #47) lives
   * in one place. Same reasoning as #36's `buildHandler` consolidation: a
   * signature change should touch one line, not nine call sites.
   */
  const record = (
    outboxEventId: string,
    eventType: string,
    failures: Parameters<FailedEventDeliveryService['recordFailures']>[2],
    organizationId: string = ORG,
  ) => service.recordFailures(outboxEventId, eventType, failures, organizationId);

  it('creates one row per failed subscriber, with attempts starting at 1', async () => {
    const recorded = await record('outbox-1', 'ExpenseApproved', [
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
    const first = await record('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'first failure'),
    ]);
    const second = await record('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'second failure'),
    ]);

    expect(second[0].id).toBe(first[0].id); // same row
    expect(second[0].attempts).toBe(2);

    const rows = await prisma.failedEventDelivery.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].lastError).toBe('second failure'); // latest error wins
  });

  it('keeps the SAME subscriber on a DIFFERENT event as a separate row', async () => {
    await record('outbox-1', 'ExpenseApproved', [failure('AuditSubscriber', 'a')]);
    await record('outbox-2', 'ExpenseRejected', [failure('AuditSubscriber', 'b')]);

    expect(await prisma.failedEventDelivery.count()).toBe(2);
  });

  it('reopens a permanently-failed pair when it fails again', async () => {
    // A fresh failure for a pair previously given up on is a live problem
    // again, not a historical one.
    const [recorded] = await record('outbox-1', 'ExpenseApproved', [
      failure('AuditSubscriber', 'first'),
    ]);
    await service.markPermanentlyFailed(recorded.id, new Error('gave up'));

    await record('outbox-1', 'ExpenseApproved', [failure('AuditSubscriber', 'happening again')]);

    const row = await prisma.failedEventDelivery.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(row.status).toBe('pending_retry');
    // Three deliveries have now been attempted: the original, the terminal one that
    // gave up, and the new failure. This asserted 2 while `attempts` was written
    // absolutely from a total the processor derived — that arithmetic assumed
    // exactly one prior delivery and so could not survive a second episode.
    expect(row.attempts).toBe(3);
  });

  describe('attempts is monotonic', () => {
    it('never decreases across episodes, including an operator redrive', async () => {
      // The regression pin for the counter defect #47 exposed. Previously a row that
      // reached 6 and was then redriven had `attempts` overwritten with 2, because
      // the processor computed `thisAttempt + 1` and assumed one prior delivery.
      // An operator reads this number to judge severity, so it going BACKWARDS was
      // worse than it being merely approximate.
      const [recorded] = await record('outbox-1', 'ExpenseApproved', [
        failure('AuditSubscriber', 'attempt 1'),
      ]);
      expect(recorded.attempts).toBe(1);

      // Four non-terminal redelivery attempts, then a terminal one: 6 total.
      for (let i = 0; i < 4; i++) {
        await service.recordAttempt(recorded.id, new Error(`retry ${i}`));
      }
      await service.markPermanentlyFailed(recorded.id, new Error('gave up'));

      const exhausted = await prisma.failedEventDelivery.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(exhausted.attempts).toBe(6);
      expect(exhausted.status).toBe('permanently_failed');

      // An operator redrive that finally succeeds is a 7th delivery attempt, not a
      // reset to 2.
      await service.markRecovered(recorded.id);

      const after = await prisma.failedEventDelivery.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(after.status).toBe('recovered');
      expect(after.attempts).toBe(7);
      expect(after.attempts).toBeGreaterThan(exhausted.attempts);
    });

    it('does NOT count an abandoned redelivery, where no subscriber ran', async () => {
      // The one opt-out. `EventRedeliveryService` marks a delivery permanently failed
      // without invoking anything when the outbox payload is gone; counting that as
      // an attempt would inflate the number rather than correct it.
      const [recorded] = await record('outbox-1', 'ExpenseApproved', [
        failure('AuditSubscriber', 'attempt 1'),
      ]);

      await service.markPermanentlyFailed(recorded.id, new Error('payload unrecoverable'), {
        countsAsAttempt: false,
      });

      const row = await prisma.failedEventDelivery.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(row.status).toBe('permanently_failed');
      expect(row.attempts).toBe(1); // unchanged
    });
  });

  it('records a recovery, and bumps updatedAt off createdAt', async () => {
    const [recorded] = await record('outbox-1', 'ExpenseApproved', [
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
    const [recorded] = await record('outbox-1', 'ExpenseApproved', [
      { subscriberName: 'AuditSubscriber', error: 'a bare string rejection' },
    ]);

    const row = await prisma.failedEventDelivery.findUniqueOrThrow({
      where: { id: recorded.id },
    });
    expect(row.lastError).toBe('a bare string rejection');
  });

  describe('organization attribution (TECH_DEBT #47)', () => {
    it('persists the organization so the operator views can scope per org', async () => {
      const [recorded] = await record(
        'outbox-1',
        'ExpenseApproved',
        [failure('AuditSubscriber', 'db down')],
        'org-77',
      );

      const row = await prisma.failedEventDelivery.findUniqueOrThrow({
        where: { id: recorded.id },
      });
      expect(row.organizationId).toBe('org-77');
    });

    it('re-attributes an existing row on a later failure of the same pair', async () => {
      // Written on UPDATE as well as CREATE deliberately: a row created before this
      // column existed carries the 'unknown' default, and the next failure of that
      // pair is the natural moment to attribute it rather than leaving it
      // permanently unlistable through the API.
      const [first] = await record(
        'outbox-1',
        'ExpenseApproved',
        [failure('AuditSubscriber', 'first')],
        'unknown',
      );

      await record(
        'outbox-1',
        'ExpenseApproved',
        [failure('AuditSubscriber', 'second')],
        'org-99',
      );

      const row = await prisma.failedEventDelivery.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.organizationId).toBe('org-99');
    });

    it('isolates two organizations into separate listable sets', async () => {
      await record('outbox-1', 'ExpenseApproved', [failure('AuditSubscriber', 'a')], 'org-a');
      await record('outbox-2', 'ExpenseApproved', [failure('AuditSubscriber', 'b')], 'org-b');

      expect(await prisma.failedEventDelivery.count({ where: { organizationId: 'org-a' } })).toBe(1);
      expect(await prisma.failedEventDelivery.count({ where: { organizationId: 'org-b' } })).toBe(1);
    });
  });
});
