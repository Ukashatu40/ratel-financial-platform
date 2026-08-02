// src/jobs/jobs.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvConfig } from '../config/env.schema';
import { OUTBOX_DISPATCH_QUEUE } from './queues/outbox-dispatch.queue';
import { OutboxDispatchService } from '../shared-kernel/outbox/outbox-dispatch.service';
import { OutboxDispatchProcessor } from './processors/outbox-dispatch.processor';
import { OutboxDispatchScheduler } from './processors/outbox-dispatch.scheduler';

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
  ],
  providers: [OutboxDispatchService, OutboxDispatchProcessor, OutboxDispatchScheduler],
  exports: [OutboxDispatchService],
})
export class JobsModule {}
