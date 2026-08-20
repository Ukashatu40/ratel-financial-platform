// test/unit/jobs/event-redelivery.processor.spec.ts
import { EventRedeliveryProcessor } from '../../../src/jobs/processors/event-redelivery.processor';
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

/**
 * The terminal-attempt branch cannot be reached in e2e without waiting out the
 * full exponential backoff (5+10+20+40s, well past the 30s test timeout), so the
 * "is this the last attempt?" logic is pinned here instead. Same shape of
 * bookkeeping NotificationProcessor already uses, so it is worth asserting
 * rather than assuming.
 */
function buildJob(attemptsMade: number, attempts = 5) {
  return { data: { failedDeliveryId: 'failure-1' }, attemptsMade, opts: { attempts } } as any;
}

function build(options: { redeliverThrows?: Error; abandonedReason?: string } = {}) {
  const redeliver = options.redeliverThrows
    ? jest.fn().mockRejectedValue(options.redeliverThrows)
    : jest.fn().mockResolvedValue(
        'abandonedReason' in options
          ? { recovered: false, abandonedReason: options.abandonedReason }
          : { recovered: true },
      );

  const failures = {
    markPermanentlyFailed: jest.fn().mockResolvedValue(undefined),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
  };

  const processor = new EventRedeliveryProcessor({ redeliver } as any, failures as any);
  return { processor, redeliver, failures };
}

describe('EventRedeliveryProcessor', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes quietly on a successful redelivery', async () => {
    const { processor, redeliver, failures } = build();

    await processor.process(buildJob(0));

    expect(redeliver).toHaveBeenCalledWith('failure-1', 2); // 1 original + this redelivery
    expect(failures.markPermanentlyFailed).not.toHaveBeenCalled();
    expect(failures.recordAttempt).not.toHaveBeenCalled();
  });

  it('counts the attempt and rethrows on a non-final failure, so BullMQ retries', async () => {
    const { processor, failures } = build({ redeliverThrows: new Error('still broken') });

    // attemptsMade 1 -> redelivery attempt 2 of 5 -> 3 total deliveries so far
    // (the original that created the record, plus two redeliveries).
    await expect(processor.process(buildJob(1))).rejects.toThrow('still broken');

    expect(failures.recordAttempt).toHaveBeenCalledWith('failure-1', 3, expect.any(Error));
    expect(failures.markPermanentlyFailed).not.toHaveBeenCalled();
  });

  it('records the FINAL total when marking permanently failed', async () => {
    // Manual verification against the live stack caught this: the row used to
    // freeze at the second-to-last count, so a permanently-failed delivery
    // under-reported how many attempts had actually been made — on exactly the
    // rows an operator looks at to judge severity.
    const { processor, failures } = build({ redeliverThrows: new Error('never recovered') });

    // attemptsMade 4 -> attempt 5 of 5 -> 6 total (1 original + 5 redeliveries)
    await expect(processor.process(buildJob(4))).rejects.toThrow('never recovered');

    expect(failures.markPermanentlyFailed).toHaveBeenCalledWith(
      'failure-1',
      expect.any(Error),
      6,
    );
  });

  it('marks permanently failed on the FINAL attempt', async () => {
    const { processor, failures } = build({ redeliverThrows: new Error('never recovered') });

    // attemptsMade 4 -> attempt 5 of 5, the last one
    await expect(processor.process(buildJob(4))).rejects.toThrow('never recovered');

    expect(failures.markPermanentlyFailed).toHaveBeenCalledTimes(1);
    expect(failures.recordAttempt).not.toHaveBeenCalled();
  });

  it('treats a single-attempt job as immediately terminal', async () => {
    // Guards the `job.opts.attempts ?? 1` fallback: with no retries configured,
    // the first failure is already the last.
    const { processor, failures } = build({ redeliverThrows: new Error('one shot') });

    await expect(processor.process(buildJob(0, 1))).rejects.toThrow('one shot');

    expect(failures.markPermanentlyFailed).toHaveBeenCalledTimes(1);
  });

  it('does NOT rethrow when the redelivery was abandoned as unrecoverable', async () => {
    // Returning rather than throwing is what stops BullMQ burning four more
    // attempts on something that can never succeed (e.g. the outbox payload is
    // gone). EventRedeliveryService owns that distinction; this asserts the
    // processor honours it.
    const { processor, failures } = build({ abandonedReason: 'payload unrecoverable' });

    await expect(processor.process(buildJob(0))).resolves.toBeUndefined();

    expect(failures.recordAttempt).not.toHaveBeenCalled();
    expect(failures.markPermanentlyFailed).not.toHaveBeenCalled();
  });
});
