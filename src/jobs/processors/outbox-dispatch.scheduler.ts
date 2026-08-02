// src/jobs/processors/outbox-dispatch.scheduler.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  OUTBOX_DISPATCH_JOB,
  OUTBOX_DISPATCH_QUEUE,
  OUTBOX_DISPATCH_REPEAT_JOB_ID,
} from '../queues/outbox-dispatch.queue';

const POLL_INTERVAL_MS = 3000;

/**
 * Registers the recurring poll job once at boot. Uses a fixed jobId
 * (OUTBOX_DISPATCH_REPEAT_JOB_ID) specifically so re-adding it on every
 * app restart doesn't stack up duplicate repeat schedules — BullMQ
 * dedupes repeatable jobs by jobId + repeat pattern automatically.
 */
@Injectable()
export class OutboxDispatchScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxDispatchScheduler.name);

  constructor(@InjectQueue(OUTBOX_DISPATCH_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      OUTBOX_DISPATCH_JOB,
      {},
      {
        repeat: { every: POLL_INTERVAL_MS },
        jobId: OUTBOX_DISPATCH_REPEAT_JOB_ID,
        removeOnComplete: { count: 10 }, // keep a small trail for debugging, don't let it grow unbounded
        removeOnFail: { count: 50 },
      },
    );
    this.logger.log(`Outbox dispatch scheduled every ${POLL_INTERVAL_MS}ms`);
  }
}
