// src/shared-kernel/outbox/outbox.service.ts
import { Injectable } from '@nestjs/common';
import { DomainEvent } from '../events/domain-event';
import { TransactionClient } from '../unit-of-work/unit-of-work.port';

/**
 * Writes events to the outbox table WITHIN the same transaction as the
 * aggregate's state mutation (Phase 5.2) — this is what guarantees a
 * state change and its event are never recorded independently of one
 * another, even across a process crash.
 */
@Injectable()
export class OutboxService {
  async enqueue(events: DomainEvent[], tx: TransactionClient): Promise<void> {
    if (events.length === 0) return;

    await tx.outboxEvent.createMany({
      data: events.map((event) => ({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        payload: event.payload as any,
      })),
    });
  }
}