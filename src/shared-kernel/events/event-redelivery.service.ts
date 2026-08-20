// src/shared-kernel/events/event-redelivery.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventDispatcher } from './domain-event-dispatcher';
import { FailedEventDeliveryService } from './failed-event-delivery.service';
import { toDomainEvent } from '../outbox/outbox-event.mapper';

export interface RedeliveryOutcome {
  /** True when the subscriber finally processed the event. */
  recovered: boolean;
  /** Set when the attempt cannot ever succeed, so retrying is pointless. */
  abandonedReason?: string;
}

/**
 * Re-invokes ONE subscriber for ONE previously-failed event (TECH_DEBT #9).
 *
 * BullMQ-free on purpose, exactly like `OutboxDispatchService`: the retry
 * policy (attempts, backoff, terminal detection) lives in the thin
 * `EventRedeliveryProcessor` wrapper, while this class holds the logic and is
 * unit-testable with a fake Prisma client and a fake dispatcher.
 */
@Injectable()
export class EventRedeliveryService {
  private readonly logger = new Logger(EventRedeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: DomainEventDispatcher,
    private readonly failures: FailedEventDeliveryService,
  ) {}

  /**
   * Throws when the caller should retry; returns instead when the situation is
   * unrecoverable and retrying would only burn attempts. That distinction is
   * the whole contract: BullMQ drives retries off the throw.
   */
  async redeliver(failedDeliveryId: string, totalAttempts?: number): Promise<RedeliveryOutcome> {
    const record = await this.prisma.failedEventDelivery.findUnique({
      where: { id: failedDeliveryId },
    });

    if (!record) {
      // Nothing to redrive — the row was cleaned up (or a test truncated it).
      // Not an error worth retrying: the target is legitimately gone.
      return { recovered: false, abandonedReason: 'failure record no longer exists' };
    }

    if (record.status === 'recovered') {
      // Already handled — e.g. an operator retried manually before the backoff
      // fired. Idempotent by design rather than double-delivering.
      this.logger.debug(
        `Delivery ${failedDeliveryId} is already recovered — skipping redundant redelivery`,
      );
      return { recovered: true };
    }

    const outboxEvent = await this.prisma.outboxEvent.findUnique({
      where: { id: record.outboxEventId },
    });

    if (!outboxEvent) {
      // The deliberate consequence of having NO foreign key (see the schema
      // comment): the outbox row can be retained-then-cleaned independently, so
      // handle its absence explicitly instead of leaning on referential
      // integrity. Without the payload there is nothing to redeliver, ever.
      const reason = `outbox event ${record.outboxEventId} no longer exists — payload unrecoverable`;
      await this.failures.markPermanentlyFailed(record.id, new Error(reason));
      this.logger.error(
        `Cannot redeliver ${record.eventType} to "${record.subscriberName}": ${reason}`,
      );
      return { recovered: false, abandonedReason: reason };
    }

    // Rebuilt through the SHARED mapper, so a retry hands the subscriber
    // exactly the event the first delivery did.
    const event = toDomainEvent(outboxEvent);

    // Deliberately not wrapped in try/catch: a genuine subscriber failure must
    // propagate so the processor can count the attempt and let BullMQ back off.
    await this.dispatcher.dispatchTo(record.subscriberName, event);

    await this.failures.markRecovered(record.id, totalAttempts);
    this.logger.log(
      `Recovered event delivery: subscriber "${record.subscriberName}" processed ` +
        `${record.eventType} (outbox event ${record.outboxEventId}) after ${record.attempts} failed attempt(s)`,
    );

    return { recovered: true };
  }
}
