// src/shared-kernel/outbox/outbox.service.ts  (replace enqueue())
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainEvent } from '../events/domain-event';
import { TransactionClient } from '../unit-of-work/unit-of-work.port';
import { RequestContext } from '../context/request-context';

@Injectable()
export class OutboxService {
  async enqueue(events: DomainEvent[], tx: TransactionClient): Promise<void> {
    if (events.length === 0) return;

    const ctx = RequestContext.current();

    await tx.outboxEvent.createMany({
      data: events.map((event) => ({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.type,
        payload: event.payload as any,
        correlationId: ctx?.correlationId ?? randomUUID(), // fallback for non-HTTP callers (seed, future jobs)
        requestId: ctx?.requestId,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        source: ctx?.source ?? 'background_worker',
      })),
    });
  }
}
