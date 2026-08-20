// src/shared-kernel/outbox/outbox-dispatch.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventDispatcher } from '../events/domain-event-dispatcher';
import { FailedEventDeliveryService } from '../events/failed-event-delivery.service';
import {
  EVENT_DELIVERY_RETRY_SCHEDULER,
  EventDeliveryRetryScheduler,
} from '../events/event-delivery-retry-scheduler.port';
import { toDomainEvent } from './outbox-event.mapper';

/**
 * Deliberately separate from OutboxDispatchProcessor (the BullMQ-specific
 * wrapper) — this class holds the actual polling/dispatch logic and has zero
 * BullMQ imports, so it's unit-testable with a fake Prisma client and a fake
 * dispatcher, independent of queue infrastructure. Same separation-of-concerns
 * reasoning as PrismaUnitOfWork wrapping a plain UnitOfWork port (Phase 5.1/M0).
 */
@Injectable()
export class OutboxDispatchService {
  private readonly logger = new Logger(OutboxDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: DomainEventDispatcher,
    private readonly failures: FailedEventDeliveryService,
    @Inject(EVENT_DELIVERY_RETRY_SCHEDULER)
    private readonly retryScheduler: EventDeliveryRetryScheduler,
  ) {}

  async dispatchPendingBatch(batchSize = 100): Promise<{ dispatched: number; failed: number }> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (pending.length === 0) return { dispatched: 0, failed: 0 };

    let dispatched = 0;
    let failed = 0;

    for (const row of pending) {
      const event = toDomainEvent(row);

      try {
        // dispatch() isolates subscribers from each other (Promise.allSettled)
        // and never throws, but it no longer SWALLOWS failures either — it
        // returns them, named. Before TECH_DEBT #9 closed, a failed subscriber
        // was logged as `Handler 2` and forgotten, which meant a transient
        // AuditSubscriber failure silently and permanently dropped that audit
        // entry — undetectably, since the hash chain proves entries weren't
        // ALTERED but says nothing about one that was never written.
        const result = await this.dispatcher.dispatch(event);

        // updateMany + WHERE status:'pending' instead of update-by-id:
        // if the row was deleted or already dispatched between the SELECT
        // above and this call (a real race — data retention, a second
        // dispatcher instance, or just test cleanup racing a live
        // background poller), this simply affects 0 rows rather than
        // throwing P2025. That's the correct outcome — "already handled
        // or gone" isn't a dispatch failure worth an ERROR log.
        //
        // Still marked 'dispatched' even when a subscriber failed, deliberately:
        // this row's status means "handed to the dispatcher", and one event has
        // N per-subscriber outcomes, which a single column cannot express.
        // Per-subscriber results live in failed_event_deliveries instead.
        const updateResult = await this.prisma.outboxEvent.updateMany({
          where: { id: row.id, status: 'pending' },
          data: { status: 'dispatched', dispatchedAt: new Date() },
        });

        if (updateResult.count === 0) {
          this.logger.debug(
            `Outbox event ${row.id} was already handled or removed before it could be marked dispatched — skipping`,
          );
        } else {
          dispatched++;
        }

        if (result.failures.length > 0) {
          failed += result.failures.length;
          await this.scheduleRetries(row.id, row.eventType, result.failures);
        }
      } catch (err) {
        // dispatch() itself shouldn't throw per the above, but guarding
        // anyway — a genuinely unexpected error here leaves the row
        // 'pending' so the next poll retries it, rather than marking it
        // 'failed' prematurely on a transient issue.
        this.logger.error(`Failed to dispatch outbox event ${row.id} (${row.eventType})`, err);
      }
    }

    return { dispatched, failed };
  }

  /**
   * Persisting the failure comes FIRST, enqueueing second. If the enqueue then
   * fails, the durable record still exists and an operator can see the loss —
   * whereas an enqueue-first ordering could lose the failure entirely if the
   * process died in between, which is the exact class of silent loss #9 is about.
   */
  private async scheduleRetries(
    outboxEventId: string,
    eventType: string,
    failures: Awaited<ReturnType<DomainEventDispatcher['dispatch']>>['failures'],
  ): Promise<void> {
    const recorded = await this.failures.recordFailures(outboxEventId, eventType, failures);

    for (const record of recorded) {
      try {
        await this.retryScheduler.scheduleRetry(record.id);
      } catch (err) {
        // The row is already durable at this point, so a queue outage degrades
        // this to "recorded but not auto-retried" rather than losing it.
        this.logger.error(
          `Recorded delivery failure ${record.id} but could not enqueue its retry — ` +
            'it will need a manual redelivery',
          err,
        );
      }
    }
  }
}
