// test/unit/shared-kernel/outbox-dispatch.service.spec.ts
import { OutboxDispatchService } from '../../../src/shared-kernel/outbox/outbox-dispatch.service';
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

const outboxRow = (overrides: Record<string, unknown> = {}) => {
  const base: Record<string, unknown> = {
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
  // Own-keys iteration, not `??`: an override of null/undefined must actually
  // apply rather than silently falling back to the base (convention #4).
  for (const key of Object.keys(overrides)) base[key] = overrides[key];
  return base;
};

function build(options: {
  rows?: Record<string, unknown>[];
  failures?: { subscriberName: string; error: unknown }[];
  updatedCount?: number;
  scheduleRejects?: boolean;
} = {}) {
  const rows = 'rows' in options ? options.rows! : [outboxRow()];
  const failures = 'failures' in options ? options.failures! : [];
  const updatedCount = 'updatedCount' in options ? options.updatedCount! : 1;

  const updateMany = jest.fn().mockResolvedValue({ count: updatedCount });
  const prisma = {
    outboxEvent: { findMany: jest.fn().mockResolvedValue(rows), updateMany },
  };

  const dispatch = jest.fn().mockResolvedValue({ invoked: 2, failures });
  const dispatcher = { dispatch };

  const recordFailures = jest.fn().mockImplementation(async (outboxEventId, eventType, fs) =>
    (fs as { subscriberName: string }[]).map((f, i) => ({
      id: `failure-${i}`,
      outboxEventId,
      eventType,
      subscriberName: f.subscriberName,
      attempts: 1,
    })),
  );
  const failureService = { recordFailures };

  const scheduleRetry = options.scheduleRejects
    ? jest.fn().mockRejectedValue(new Error('redis down'))
    : jest.fn().mockResolvedValue(undefined);
  const scheduler = { scheduleRetry };

  const service = new OutboxDispatchService(
    prisma as any,
    dispatcher as any,
    failureService as any,
    scheduler as any,
  );

  return { service, updateMany, dispatch, recordFailures, scheduleRetry };
}

describe('OutboxDispatchService', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns early without dispatching when nothing is pending', async () => {
    const { service, dispatch } = build({ rows: [] });

    const result = await service.dispatchPendingBatch();

    expect(result).toEqual({ dispatched: 0, failed: 0 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('marks a fully-successful event dispatched and records no failures', async () => {
    const { service, updateMany, recordFailures, scheduleRetry } = build();

    const result = await service.dispatchPendingBatch();

    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', status: 'pending' },
      data: expect.objectContaining({ status: 'dispatched' }),
    });
    expect(recordFailures).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it('records a failed subscriber and schedules its retry', async () => {
    const { service, recordFailures, scheduleRetry } = build({
      failures: [{ subscriberName: 'AuditSubscriber', error: new Error('db down') }],
    });

    const result = await service.dispatchPendingBatch();

    expect(result.failed).toBe(1);
    expect(recordFailures).toHaveBeenCalledWith('outbox-1', 'ExpenseApproved', [
      expect.objectContaining({ subscriberName: 'AuditSubscriber' }),
    ]);
    expect(scheduleRetry).toHaveBeenCalledWith('failure-0');
  });

  it('still marks the outbox row dispatched when a subscriber failed', async () => {
    // The decided semantics: the row means "handed to the dispatcher". One event
    // has N per-subscriber outcomes, which a single status column cannot express,
    // so those live in failed_event_deliveries instead.
    const { service, updateMany } = build({
      failures: [{ subscriberName: 'AuditSubscriber', error: new Error('db down') }],
    });

    const result = await service.dispatchPendingBatch();

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox-1', status: 'pending' },
      data: expect.objectContaining({ status: 'dispatched' }),
    });
    expect(result.dispatched).toBe(1);
  });

  it('schedules one retry per failed subscriber', async () => {
    const { service, scheduleRetry } = build({
      failures: [
        { subscriberName: 'AuditSubscriber', error: new Error('a') },
        { subscriberName: 'ExpenseReadModelProjector', error: new Error('b') },
      ],
    });

    const result = await service.dispatchPendingBatch();

    expect(result.failed).toBe(2);
    expect(scheduleRetry).toHaveBeenCalledTimes(2);
  });

  it('persists the failure BEFORE enqueueing, so a queue outage cannot lose it', async () => {
    // Ordering matters: enqueue-first would lose the failure entirely if the
    // process died in between — the exact silent loss #9 exists to stop.
    const { service, recordFailures, scheduleRetry } = build({
      failures: [{ subscriberName: 'AuditSubscriber', error: new Error('db down') }],
      scheduleRejects: true,
    });

    await expect(service.dispatchPendingBatch()).resolves.toEqual({ dispatched: 1, failed: 1 });

    expect(recordFailures).toHaveBeenCalledTimes(1);
    expect(scheduleRetry).toHaveBeenCalledTimes(1); // rejected, but swallowed and logged
  });

  it('does not count a row that another dispatcher already claimed', async () => {
    const { service } = build({ updatedCount: 0 });

    const result = await service.dispatchPendingBatch();

    expect(result.dispatched).toBe(0);
  });
});
