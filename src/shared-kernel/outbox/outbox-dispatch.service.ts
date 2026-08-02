// src/shared-kernel/outbox/outbox-dispatch.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventDispatcher } from '../events/domain-event-dispatcher';
import { DomainEvent } from '../events/domain-event';

/**
 * Deliberately separate from OutboxDispatchProcessor (the BullMQ-specific
 * wrapper below) — this class holds the actual polling/dispatch logic and
 * has zero BullMQ imports, so it's unit-testable with a fake Prisma client
 * and a fake dispatcher, independent of queue infrastructure. Same
 * separation-of-concerns reasoning as PrismaUnitOfWork wrapping a plain
 * UnitOfWork port (Phase 5.1/M0).
 */
@Injectable()
export class OutboxDispatchService {
  private readonly logger = new Logger(OutboxDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: DomainEventDispatcher,
  ) {}

  async dispatchPendingBatch(batchSize = 100): Promise<{ dispatched: number }> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (pending.length === 0) return { dispatched: 0 };

    let dispatched = 0;

    for (const row of pending) {
      const event: DomainEvent = {
        type: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        occurredAt: row.createdAt,
        payload: row.payload as Record<string, unknown>,
        correlationId: row.correlationId,
        requestId: row.requestId ?? undefined,
        ipAddress: row.ipAddress ?? undefined,
        userAgent: row.userAgent ?? undefined,
        source: row.source,
      };

      try {
        // DomainEventDispatcher.dispatch() already catches individual
        // subscriber failures internally (Promise.allSettled, M0) and only
        // logs them — it never throws. So reaching this point means the
        // event was delivered to every registered handler, even if one of
        // them failed. That's a known simplification worth flagging: a
        // failed subscriber (e.g. Audit write fails) currently only gets
        // logged, not retried or DLQ'd. Revisit if/when a subscriber's
        // reliability matters enough to need its own retry path — the
        // pattern from the Integration Layer's DLQ (Phase 8.3) would apply
        // here too, but wasn't built into this v1.
        await this.dispatcher.dispatch(event);

        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: 'dispatched', dispatchedAt: new Date() },
        });
        dispatched++;
      } catch (err) {
        // dispatch() itself shouldn't throw per the above, but guarding
        // anyway — a genuinely unexpected error here leaves the row
        // 'pending' so the next poll retries it, rather than marking it
        // 'failed' prematurely on a transient issue.
        this.logger.error(`Failed to dispatch outbox event ${row.id} (${row.eventType})`, err);
      }
    }

    return { dispatched };
  }
}
