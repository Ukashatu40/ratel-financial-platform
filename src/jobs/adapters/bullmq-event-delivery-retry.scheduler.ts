// src/jobs/adapters/bullmq-event-delivery-retry.scheduler.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EventDeliveryRetryScheduler } from '../../shared-kernel/events/event-delivery-retry-scheduler.port';
import {
  EVENT_REDELIVERY_JOB_NAME,
  EVENT_REDELIVERY_JOB_OPTIONS,
  EVENT_REDELIVERY_QUEUE,
  EventRedeliveryPayload,
} from '../queues/event-redelivery.queue';

/** The BullMQ side of EventDeliveryRetryScheduler — the only place that knows a queue exists. */
@Injectable()
export class BullMqEventDeliveryRetryScheduler implements EventDeliveryRetryScheduler {
  constructor(@InjectQueue(EVENT_REDELIVERY_QUEUE) private readonly queue: Queue) {}

  async scheduleRetry(failedDeliveryId: string): Promise<void> {
    const payload: EventRedeliveryPayload = { failedDeliveryId };

    await this.queue.add(EVENT_REDELIVERY_JOB_NAME, payload, {
      ...EVENT_REDELIVERY_JOB_OPTIONS,
      // Deduplicated by failure-record id: if the same pair is somehow
      // scheduled twice, BullMQ keeps one job rather than running the
      // subscriber twice concurrently.
      //
      // A HYPHEN, not a colon — BullMQ rejects a custom jobId containing ':'
      // ("Custom Id cannot contain :", Job.validateOptions) because it uses
      // colons internally for Redis key namespacing. Found by the e2e test,
      // which is the only place this would ever have surfaced: the throw was
      // caught and logged as "could not enqueue its retry", so retries were
      // silently never scheduled while everything else looked healthy.
      jobId: `redeliver-${failedDeliveryId}`,
    });
  }
}
