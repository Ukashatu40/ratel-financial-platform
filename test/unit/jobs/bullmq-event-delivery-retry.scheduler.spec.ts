// test/unit/jobs/bullmq-event-delivery-retry.scheduler.spec.ts
import { BullMqEventDeliveryRetryScheduler } from '../../../src/jobs/adapters/bullmq-event-delivery-retry.scheduler';
import { EVENT_REDELIVERY_JOB_NAME } from '../../../src/jobs/queues/event-redelivery.queue';
import { beforeEach, describe, expect, it } from '@jest/globals';

/**
 * The PROOF that redelivery survives a repeat failure lives in
 * `test/e2e/event-delivery-retry.e2e.spec.ts` — a fake Queue cannot exhibit
 * BullMQ's jobId-retention semantics, which is the entire mechanism of the bug.
 *
 * What this file guards is cheaper and narrower: the two halves of that fix are
 * in different files (the id is chosen here, the options that release it live in
 * `event-redelivery.queue.ts`), so a well-meaning edit to either one alone
 * silently re-breaks it. Catching that in seconds via `npm test` beats waiting
 * on a 60s e2e round trip — the same fast-guard/real-proof split #9 used for the
 * processor's terminal-attempt branch.
 */
function build() {
  const add = jest.fn().mockResolvedValue({ id: 'job-1' });
  const scheduler = new BullMqEventDeliveryRetryScheduler({ add } as any);
  return { scheduler, add };
}

/** The options object the adapter handed BullMQ. */
const optionsFrom = (add: jest.Mock) => add.mock.calls[0][2] as Record<string, unknown>;

describe('BullMqEventDeliveryRetryScheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enqueues the redelivery job carrying the failure row id', async () => {
    const { scheduler, add } = build();

    await scheduler.scheduleRetry('failure-1');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toBe(EVENT_REDELIVERY_JOB_NAME);
    expect(add.mock.calls[0][1]).toEqual({ failedDeliveryId: 'failure-1' });
  });

  it('deduplicates on a jobId derived from the failure row', async () => {
    const { scheduler, add } = build();

    await scheduler.scheduleRetry('failure-1');

    expect(optionsFrom(add).jobId).toBe('redeliver-failure-1');
  });

  it('never puts a colon in the jobId', async () => {
    // Pins TECH_DEBT #9's second bug: BullMQ throws "Custom Id cannot contain :"
    // because it namespaces Redis keys with colons. The throw was swallowed and
    // logged, so retries were silently never scheduled while everything looked
    // healthy. UUIDs contain hyphens, not colons, but the separator is the part
    // that has to stay deliberate.
    const { scheduler, add } = build();

    await scheduler.scheduleRetry('3f2504e0-4f89-11d3-9a0c-0305e82c3301');

    expect(String(optionsFrom(add).jobId)).not.toContain(':');
  });

  it('releases the jobId once the job finishes, so a repeat failure can requeue', async () => {
    // THE regression pin, and the reason this file exists. The jobId above is
    // stable across failure episodes — `failed_event_deliveries` is upserted on
    // its (outboxEventId, subscriberName) unique, so the same pair failing again
    // reuses the same row id. BullMQ honours a custom jobId in `completed` and
    // `failed` too, so without these two options the finished job stays in Redis
    // under that id and the next enqueue is a silent no-op: the row goes back to
    // `pending_retry` and then never moves, and #47's operator retry endpoint
    // would do nothing at all.
    //
    // If a future change drops these, the dedupe key must change shape too —
    // failing here is the prompt to go read why.
    const { scheduler, add } = build();

    await scheduler.scheduleRetry('failure-1');

    expect(optionsFrom(add).removeOnComplete).toBe(true);
    expect(optionsFrom(add).removeOnFail).toBe(true);
  });

  it('keeps the backoff policy the failure record depends on', async () => {
    // 5 attempts on exponential backoff from 5s is what makes `attempts` on the
    // row meaningful and spans a container restart; asserted so a change to it is
    // deliberate rather than incidental.
    const { scheduler, add } = build();

    await scheduler.scheduleRetry('failure-1');

    expect(optionsFrom(add).attempts).toBe(5);
    expect(optionsFrom(add).backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});
