// src/jobs/jobs.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvConfig } from '../config/env.schema';
import { OUTBOX_DISPATCH_QUEUE } from './queues/outbox-dispatch.queue';
import {
  EVENT_REDELIVERY_JOB_OPTIONS,
  EVENT_REDELIVERY_QUEUE,
} from './queues/event-redelivery.queue';
import { OutboxDispatchService } from '../shared-kernel/outbox/outbox-dispatch.service';
import { OutboxDispatchProcessor } from './processors/outbox-dispatch.processor';
import { OutboxDispatchScheduler } from './processors/outbox-dispatch.scheduler';
import { EventRedeliveryProcessor } from './processors/event-redelivery.processor';
import { EventRedeliveryService } from '../shared-kernel/events/event-redelivery.service';
import { FailedEventDeliveryService } from '../shared-kernel/events/failed-event-delivery.service';
import { EVENT_DELIVERY_RETRY_SCHEDULER } from '../shared-kernel/events/event-delivery-retry-scheduler.port';
import { BullMqEventDeliveryRetryScheduler } from './adapters/bullmq-event-delivery-retry.scheduler';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
        },
      }),
    }),
    BullModule.registerQueue({ name: OUTBOX_DISPATCH_QUEUE }),
    // Registered HERE rather than in SharedKernelModule specifically because
    // both the producer (OutboxDispatchService, via the scheduler adapter below)
    // and the consumer (EventRedeliveryProcessor) are providers of THIS module.
    // Splitting them across modules is what caused TECH_DEBT #36's first bug,
    // where a queue token couldn't be resolved because BullModule wasn't
    // re-exported. Keeping both sides here means there is nothing to re-export.
    BullModule.registerQueue({
      name: EVENT_REDELIVERY_QUEUE,
      defaultJobOptions: EVENT_REDELIVERY_JOB_OPTIONS,
    }),
  ],
  providers: [
    OutboxDispatchService,
    OutboxDispatchProcessor,
    OutboxDispatchScheduler,
    FailedEventDeliveryService,
    EventRedeliveryService,
    EventRedeliveryProcessor,
    { provide: EVENT_DELIVERY_RETRY_SCHEDULER, useClass: BullMqEventDeliveryRetryScheduler },
  ],
  exports: [OutboxDispatchService, FailedEventDeliveryService, EventRedeliveryService],
})
export class JobsModule {}
