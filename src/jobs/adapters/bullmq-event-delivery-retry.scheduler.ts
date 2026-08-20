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
      // Deduplicated by failure-record id so one failure row never has two LIVE
      // retry jobs racing the same subscriber concurrently.
      //
      // "Live" is the whole subtlety, and it only holds because
      // EVENT_REDELIVERY_JOB_OPTIONS sets removeOnComplete/removeOnFail — read
      // the comment there before changing either. This id is stable across
      // failure episodes (the row is upserted on its unique pair), and BullMQ
      // honours a custom jobId in `completed`/`failed` too, so retaining
      // finished jobs would silently turn every subsequent enqueue for the same
      // pair into a no-op.
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
