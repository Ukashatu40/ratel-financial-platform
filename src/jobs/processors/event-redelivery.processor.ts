// src/jobs/processors/event-redelivery.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventRedeliveryService } from '../../shared-kernel/events/event-redelivery.service';
import { FailedEventDeliveryService } from '../../shared-kernel/events/failed-event-delivery.service';
import { EVENT_REDELIVERY_QUEUE, EventRedeliveryPayload } from '../queues/event-redelivery.queue';

/**
 * Thin BullMQ wrapper around EventRedeliveryService — same split as
 * OutboxDispatchProcessor/OutboxDispatchService. Owns only the retry policy
 * bookkeeping: which attempt this is, whether it was the last one, and the
 * rethrow that BullMQ needs to actually schedule the next attempt.
 */
@Processor(EVENT_REDELIVERY_QUEUE)
export class EventRedeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(EventRedeliveryProcessor.name);

  constructor(
    private readonly redelivery: EventRedeliveryService,
    private readonly failures: FailedEventDeliveryService,
  ) {
    super();
  }

  async process(job: Job<EventRedeliveryPayload>): Promise<void> {
    const { failedDeliveryId } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    try {
      const outcome = await this.redelivery.redeliver(failedDeliveryId);

      if (!outcome.recovered && outcome.abandonedReason) {
        // Unrecoverable rather than failed: returning (not throwing) stops
        // BullMQ retrying something that can never succeed.
        this.logger.warn(
          `Abandoned redelivery of ${failedDeliveryId} on attempt ${attempt}/${maxAttempts}: ${outcome.abandonedReason}`,
        );
      }
      return;
    } catch (err) {
      const isLastAttempt = attempt >= maxAttempts;

      // Neither branch is handed an attempt COUNT any more. This processor only
      // knows which attempt of THIS job it is on, which is not the pair's total
      // once a row has survived more than one failure episode or an operator
      // redrive — computing `attempt + 1` here is what made `attempts` regress.
      // FailedEventDeliveryService now increments, so the count belongs to the row.
      if (isLastAttempt) {
        await this.failures.markPermanentlyFailed(failedDeliveryId, err);
      } else {
        await this.failures.recordAttempt(failedDeliveryId, err);
      }

      this.logger.error(
        `Event redelivery ${failedDeliveryId} failed — attempt ${attempt}/${maxAttempts} — ` +
          `${isLastAttempt ? 'PERMANENTLY FAILED, no more retries' : 'will retry'} — ` +
          `${(err as Error).message}`,
      );

      throw err; // BullMQ needs the throw to schedule the next attempt
    }
  }
}
