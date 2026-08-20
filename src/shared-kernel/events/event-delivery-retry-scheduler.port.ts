// src/shared-kernel/events/event-delivery-retry-scheduler.port.ts

/**
 * How a recorded delivery failure gets queued for another attempt.
 *
 * A port rather than a direct BullMQ `Queue` injection specifically so
 * `OutboxDispatchService` keeps its documented property of having zero BullMQ
 * imports — that is the whole reason it exists as a separate class from
 * `OutboxDispatchProcessor`, and injecting a Queue there would quietly undo it
 * and make the class untestable without queue infrastructure.
 */
export interface EventDeliveryRetryScheduler {
  scheduleRetry(failedDeliveryId: string): Promise<void>;
}

export const EVENT_DELIVERY_RETRY_SCHEDULER = Symbol('EVENT_DELIVERY_RETRY_SCHEDULER');
