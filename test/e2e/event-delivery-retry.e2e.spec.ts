// test/e2e/event-delivery-retry.e2e.spec.ts
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './setup/app.helper';
import { cleanE2eDatabase, getE2eDbClient } from './setup/e2e-db-helper';
import { DomainEventDispatcher } from '../../src/shared-kernel/events/domain-event-dispatcher';
import { describe, expect, it, beforeAll, beforeEach, afterAll } from '@jest/globals';

/**
 * TECH_DEBT #9 — a subscriber that failed used to be logged and forgotten, so a
 * transient AuditSubscriber failure permanently dropped that audit entry. And
 * undetectably: the audit hash chain proves entries were not ALTERED, but a
 * chain missing an entry entirely is still a perfectly valid chain.
 *
 * Nothing here is mocked. The test registers an extra, deliberately-flaky
 * subscriber into the REAL DomainEventDispatcher of the REAL booted app, writes
 * a real outbox row, and lets the real BullMQ poller, real redelivery queue and
 * real Postgres do the rest. The dispatcher is a runtime registry, so this is
 * ordinary use of it rather than a test seam bolted on for the occasion.
 */
describe('Event delivery retry (e2e)', () => {
  let app: NestFastifyApplication;
  let dispatcher: DomainEventDispatcher;

  // A type nothing else subscribes to, so the only subscribers reached are the
  // global AuditSubscriber and whichever flaky one the test registers. Keeps
  // the assertions about "who ran, how many times" unambiguous.
  const EVENT_TYPE = 'EventDeliveryRetryProbe';

  beforeAll(async () => {
    app = await createTestApp();
    dispatcher = app.get(DomainEventDispatcher);
  });

  afterAll(async () => {
    // Guarded for the same reason as every other e2e spec: an unguarded close
    // on a failed boot throws a second error that hides the real one.
    await app?.close();
  });

  beforeEach(async () => {
    await cleanE2eDatabase();
  });

  /** Writes the pipeline's real input and lets the live poller pick it up. */
  async function enqueueOutboxEvent(): Promise<string> {
    const prisma = getE2eDbClient();
    const row = await prisma.outboxEvent.create({
      data: {
        aggregateType: 'Probe',
        aggregateId: `probe-${Date.now()}`,
        eventType: EVENT_TYPE,
        payload: { organizationId: 'org-probe' },
        correlationId: 'e2e-retry-probe',
        status: 'pending',
      },
    });
    return row.id;
  }

  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 25000,
    intervalMs = 500,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  };

  it('recovers a transiently-failing subscriber, and records the recovery', async () => {
    let calls = 0;
    // Fails its first delivery, succeeds when redelivered — the exact shape of
    // the transient DB blip that used to lose an audit entry outright.
    dispatcher.register(
      EVENT_TYPE,
      async () => {
        calls++;
        if (calls === 1) throw new Error('transient failure on first delivery');
      },
      'FlakyProbeSubscriber',
    );

    const outboxEventId = await enqueueOutboxEvent();
    const prisma = getE2eDbClient();

    const recovered = await waitFor(async () => {
      const row = await prisma.failedEventDelivery.findFirst({
        where: { outboxEventId, subscriberName: 'FlakyProbeSubscriber' },
      });
      return row?.status === 'recovered';
    });

    expect(recovered).toBe(true);
    // Ran twice in total: the failed original delivery, then the redelivery.
    expect(calls).toBe(2);

    const row = await prisma.failedEventDelivery.findFirstOrThrow({
      where: { outboxEventId, subscriberName: 'FlakyProbeSubscriber' },
    });
    expect(row.eventType).toBe(EVENT_TYPE);
    expect(row.lastError).toContain('transient failure on first delivery');
  });

  it('does NOT re-run the subscribers that already succeeded', async () => {
    // The isolation guarantee, and the reason retry is per-(event, subscriber)
    // rather than per-event: NotificationSubscriber enqueues email, so redriving
    // a whole event to recover one failed subscriber would send duplicates.
    //
    // Asserted through real production code: AuditSubscriber is global, so it
    // audits this event too. It must have written exactly ONE entry even though
    // the flaky subscriber was invoked twice.
    let calls = 0;
    dispatcher.register(
      EVENT_TYPE,
      async () => {
        calls++;
        if (calls === 1) throw new Error('transient');
      },
      'IsolationProbeSubscriber',
    );

    const outboxEventId = await enqueueOutboxEvent();
    const prisma = getE2eDbClient();

    await waitFor(async () => {
      const row = await prisma.failedEventDelivery.findFirst({
        where: { outboxEventId, subscriberName: 'IsolationProbeSubscriber' },
      });
      return row?.status === 'recovered';
    });

    expect(calls).toBe(2);

    const auditEntries = await prisma.auditLogEntry.findMany({
      where: { entityType: 'Probe' },
    });
    expect(auditEntries).toHaveLength(1); // exactly once, not twice
  });

  it('records nothing when every subscriber succeeds', async () => {
    // The control: a failure row must mean something actually failed, not merely
    // that an event passed through the pipeline.
    dispatcher.register(EVENT_TYPE, async () => undefined, 'HealthyProbeSubscriber');

    const outboxEventId = await enqueueOutboxEvent();
    const prisma = getE2eDbClient();

    const dispatched = await waitFor(async () => {
      const row = await prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
      return row?.status === 'dispatched';
    });

    expect(dispatched).toBe(true);
    expect(await prisma.failedEventDelivery.count({ where: { outboxEventId } })).toBe(0);
  });

  it('schedules a retry for a SECOND failure of the same (event, subscriber) pair', async () => {
    // The regression pin for the jobId dedupe defect found while scoping #47.
    //
    // `failed_event_deliveries` is upserted on its (outboxEventId,
    // subscriberName) unique, so a pair that fails, recovers, then fails again
    // reuses the SAME row — and therefore the same `redeliver-<id>` jobId. BullMQ
    // honours a custom jobId in `completed`/`failed` as well as in flight, so
    // while finished jobs were retained in Redis the second episode's
    // `queue.add()` returned the already-completed job and enqueued nothing. The
    // row dutifully went back to `pending_retry` (recordFailures resets it on
    // purpose) and then sat there forever, with no job to move it.
    //
    // Fails before the fix: `calls` stops at 3 and the row never leaves
    // `pending_retry`. Only reachable end to end — a fake Queue cannot exhibit
    // BullMQ's id-retention semantics, which is the same reason #9's colon bug
    // was invisible until this suite ran.
    let calls = 0;
    dispatcher.register(
      EVENT_TYPE,
      async () => {
        calls++;
        // Fail the first delivery of each episode, succeed on its redelivery.
        if (calls === 1 || calls === 3) throw new Error(`failure on delivery ${calls}`);
      },
      'RepeatFailureProbeSubscriber',
    );

    const prisma = getE2eDbClient();
    const outboxEventId = await enqueueOutboxEvent();

    const findRow = () =>
      prisma.failedEventDelivery.findFirst({
        where: { outboxEventId, subscriberName: 'RepeatFailureProbeSubscriber' },
      });

    // --- Episode 1: the path #9 already covered, here only to create the row
    // (and, crucially, to leave a FINISHED job behind under its jobId).
    expect(await waitFor(async () => (await findRow())?.status === 'recovered')).toBe(true);
    const firstEpisode = await findRow();
    // At LEAST 2, not exactly 2. Outbox dispatch is at-least-once: the poller's
    // `updateMany({where: {status: 'pending'}})` guard protects the status WRITE
    // from a concurrent cycle, not the dispatch itself, so an event can
    // occasionally reach subscribers twice — OutboxDispatchService says as much in
    // its own comment. Asserting an exact count here made this test fail
    // intermittently with 5 deliveries; the count is not the property under test.
    expect(calls).toBeGreaterThanOrEqual(2);

    // --- Episode 2: re-dispatch the same outbox event. Resetting the row to
    // 'pending' is exactly what the live poller consumes, so this drives a real
    // second delivery through production code rather than simulating one.
    await prisma.outboxEvent.update({
      where: { id: outboxEventId },
      data: { status: 'pending', dispatchedAt: null },
    });

    // The third delivery must happen and fail. Asserted on the CALL COUNT, not on
    // the row reaching `pending_retry`: BullMQ's backoff applies only BETWEEN
    // attempts of one job, so a newly-added retry job runs its first attempt
    // immediately. Post-fix the row therefore goes pending_retry -> recovered in
    // milliseconds, which a 500ms poll reliably misses — an intermediate-state
    // assertion here passes only while the bug is present, which is precisely
    // backwards. `calls` is monotonic, so it cannot be missed.
    expect(await waitFor(async () => calls >= 3)).toBe(true);

    // ...and THIS is the assertion the bug broke: a retry must actually be
    // scheduled for the revived row, so the fourth delivery happens and it
    // recovers a second time.
    expect(await waitFor(async () => (await findRow())?.status === 'recovered', 30000)).toBe(true);
    // A fourth delivery must have happened — that is what "a retry was actually
    // scheduled" means observably. Pre-fix this stalls at 3 and the wait above
    // times out, so the test stays decisive without pinning an exact count.
    expect(calls).toBeGreaterThanOrEqual(4);

    const secondEpisode = await findRow();
    // Same row throughout — which is precisely why the jobId collided. If this
    // ever becomes two rows, the dedupe reasoning above no longer applies and
    // this test is testing something else.
    expect(secondEpisode?.id).toBe(firstEpisode?.id);
    expect(await prisma.failedEventDelivery.count({ where: { outboxEventId } })).toBe(1);
  }, 90000);
});
