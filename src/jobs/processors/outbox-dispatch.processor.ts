// src/jobs/processors/outbox-dispatch.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OUTBOX_DISPATCH_QUEUE } from '../queues/outbox-dispatch.queue';
import { OutboxDispatchService } from '../../shared-kernel/outbox/outbox-dispatch.service';

@Processor(OUTBOX_DISPATCH_QUEUE)
export class OutboxDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxDispatchProcessor.name);

  constructor(private readonly outboxDispatchService: OutboxDispatchService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const { dispatched } = await this.outboxDispatchService.dispatchPendingBatch();
    if (dispatched > 0) {
      this.logger.log(`Dispatched ${dispatched} outbox event(s)`);
    }
  }
}
