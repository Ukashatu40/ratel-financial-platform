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
};

export interface EventRedeliveryPayload {
  /** `failed_event_deliveries.id` — the row this job is redriving. */
  failedDeliveryId: string;
}
