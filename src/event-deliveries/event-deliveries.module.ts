// src/event-deliveries/event-deliveries.module.ts
import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { EventDeliveryController } from './presentation/event-delivery.controller';
import {
  ListEventDeliveriesHandler,
  GetEventDeliveryByIdHandler,
  RetryEventDeliveryHandler,
} from './application/event-delivery.handlers';

/**
 * A top-level supporting module alongside `NotificationsModule`, NOT a bounded
 * context — bounded contexts live under `src/contexts/`. Failed event deliveries
 * are infrastructure bookkeeping about the event pipeline, with no aggregate, no
 * state machine and no business rules, so full DDD layering would be ceremony.
 *
 * `JobsModule` is imported for `EVENT_DELIVERY_RETRY_SCHEDULER` — the SAME port
 * `OutboxDispatchService` uses to schedule an automatic retry, so a manual redrive
 * and an automatic one go through one mechanism rather than two that can drift.
 * That port was provided but never exported until this module needed it (recorded
 * under #9's correction).
 */
@Module({
  imports: [JobsModule],
  controllers: [EventDeliveryController],
  providers: [
    ListEventDeliveriesHandler,
    GetEventDeliveryByIdHandler,
    RetryEventDeliveryHandler,
  ],
})
export class EventDeliveriesModule {}
