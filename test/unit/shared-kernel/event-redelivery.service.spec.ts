// test/unit/shared-kernel/event-redelivery.service.spec.ts
import { EventRedeliveryService } from '../../../src/shared-kernel/events/event-redelivery.service';
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

const failureRecord = (overrides: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
    id: 'failure-1',
    outboxEventId: 'outbox-1',
    eventType: 'ExpenseApproved',
    subscriberName: 'AuditSubscriber',
    attempts: 1,
    status: 'pending_retry',
  };
  for (const key of Object.keys(overrides)) base[key] = overrides[key];
  return base;
};

const outboxRow = {
  id: 'outbox-1',
  eventType: 'ExpenseApproved',
  aggregateType: 'Expense',
  aggregateId: 'exp-1',
  createdAt: new Date('2026-08-19T00:00:00.000Z'),
  payload: { organizationId: 'org-1' },
  correlationId: 'corr-1',
  requestId: null,
  ipAddress: null,
  userAgent: null,
  source: 'http',
};

function build(options: {
  record?: Record<string, unknown> | null;
  outbox?: Record<string, unknown> | null;
  dispatchThrows?: Error;
} = {}) {
  const record = 'record' in options ? options.record : failureRecord();
  const outbox = 'outbox' in options ? options.outbox : outboxRow;

  const prisma = {
    failedEventDelivery: { findUnique: jest.fn().mockResolvedValue(record) },
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(outbox) },
  };

  const dispatchTo = options.dispatchThrows
    ? jest.fn().mockRejectedValue(options.dispatchThrows)
    : jest.fn().mockResolvedValue(undefined);
  const dispatcher = { dispatchTo };

  const failures = {
    markRecovered: jest.fn().mockResolvedValue(undefined),
    markPermanentlyFailed: jest.fn().mockResolvedValue(undefined),
  };

  const service = new EventRedeliveryService(prisma as any, dispatcher as any, failures as any);
  return { service, dispatchTo, failures };
}

describe('EventRedeliveryService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redelivers to the recorded subscriber and marks it recovered', async () => {
    const { service, dispatchTo, failures } = build();

    const outcome = await service.redeliver('failure-1', 2);

    expect(outcome.recovered).toBe(true);
    expect(dispatchTo).toHaveBeenCalledWith(
      'AuditSubscriber',
      expect.objectContaining({ type: 'ExpenseApproved', aggregateId: 'exp-1' }),
    );
    // Total attempts recorded on recovery too, so a recovered row shows how many
    // tries it actually took rather than freezing at the first failure.
    expect(failures.markRecovered).toHaveBeenCalledWith('failure-1', 2);
  });

  it('rebuilds the event through the shared mapper, including outbox-only context', async () => {
    // A retry must hand the subscriber the SAME event the first delivery did —
    // reconstructing it separately here is the drift risk the shared mapper exists for.
    const { service, dispatchTo } = build();

    await service.redeliver('failure-1');

    expect(dispatchTo.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        correlationId: 'corr-1',
        source: 'http',
        occurredAt: outboxRow.createdAt,
        requestId: undefined, // null in the row, normalized to undefined
      }),
    );
  });

  it('abandons quietly when the failure record is gone', async () => {
    const { service, dispatchTo } = build({ record: null });

    const outcome = await service.redeliver('failure-1');

    expect(outcome.recovered).toBe(false);
    expect(outcome.abandonedReason).toContain('no longer exists');
    expect(dispatchTo).not.toHaveBeenCalled();
  });

  it('does not re-deliver a record already marked recovered', async () => {
    // Idempotence: an operator retrying manually before the backoff fires must
    // not cause a second delivery.
    const { service, dispatchTo, failures } = build({
      record: failureRecord({ status: 'recovered' }),
    });

    const outcome = await service.redeliver('failure-1');

    expect(outcome.recovered).toBe(true);
    expect(dispatchTo).not.toHaveBeenCalled();
    expect(failures.markRecovered).not.toHaveBeenCalled();
  });

  it('permanently fails when the outbox event is gone, since the payload is unrecoverable', async () => {
    // The deliberate consequence of having no FK to OutboxEvent — handled
    // explicitly rather than leaning on referential integrity.
    const { service, dispatchTo, failures } = build({ outbox: null });

    const outcome = await service.redeliver('failure-1');

    expect(outcome.recovered).toBe(false);
    expect(outcome.abandonedReason).toContain('unrecoverable');
    expect(dispatchTo).not.toHaveBeenCalled();
    expect(failures.markPermanentlyFailed).toHaveBeenCalledWith(
      'failure-1',
      expect.objectContaining({ message: expect.stringContaining('no longer exists') }),
    );
  });

  it('propagates a still-failing subscriber and does NOT mark it recovered', async () => {
    // The processor needs the throw to count the attempt and let BullMQ back off.
    const { service, failures } = build({ dispatchThrows: new Error('still broken') });

    await expect(service.redeliver('failure-1')).rejects.toThrow('still broken');

    expect(failures.markRecovered).not.toHaveBeenCalled();
  });
});
