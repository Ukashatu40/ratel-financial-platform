// src/jobs/queues/event-redelivery.queue.ts
export const EVENT_REDELIVERY_QUEUE = 'event-redelivery';
export const EVENT_REDELIVERY_JOB_NAME = 'redeliver-event';

/**
 * A failed subscriber is usually failing for a transient reason (a dropped DB
 * connection, a restarting dependency), so back off rather than hammering:
 * 5 attempts on exponential backoff from 5s spans roughly a minute and a half,
 * which covers a container restart without keeping a job alive for hours.
 */
export const EVENT_REDELIVERY_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5000 },

  // LOAD-BEARING, not housekeeping. The scheduler uses a custom `jobId` derived
  // from the failure row's id (see BullMqEventDeliveryRetryScheduler), and that
  // id is STABLE across failure episodes because `failed_event_deliveries` is
  // upserted on its (outboxEventId, subscriberName) unique — the same pair
  // failing again reuses the same row, hence the same jobId.
  //
  // BullMQ treats a custom jobId as an idempotency key in EVERY state, including
  // `completed` and `failed`. Without these two options a finished job stays in
  // Redis forever under that id, so the next `queue.add()` for the same pair
  // returns the existing job and enqueues NOTHING — silently. That defeated
  // `recordFailures`, which deliberately resets a `permanently_failed` row back
  // to `pending_retry` because "a fresh failure for a pair that had been given up
  // on is a live problem again": the row revived, but no retry was ever
  // scheduled. It would equally have made TECH_DEBT #47's operator retry
  // endpoint a guaranteed no-op.
  //
  // Removing finished jobs releases the id, which narrows the dedupe window to
  // exactly what was intended: one LIVE retry per failure row (waiting, active,
  // delayed or between attempts), while a new episode can always be scheduled.
  // Nothing is lost by discarding the Redis job — per #9's design the durable
  // record is the Postgres row (`status`, `attempts`, `lastError`), which is also
  // what #47 will read. This additionally bounds Redis growth, which retaining
  // every completed and permanently-failed job did not.
  removeOnComplete: true,
  removeOnFail: true,
};

export interface EventRedeliveryPayload {
  /** `failed_event_deliveries.id` — the row this job is redriving. */
  failedDeliveryId: string;
}
