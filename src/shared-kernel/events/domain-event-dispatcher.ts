// src/shared-kernel/events/domain-event-dispatcher.ts
import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from './domain-event';

type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * In-process pub/sub, deliberately explicit (no NestJS EventEmitter magic
 * strings) so `grep`-ing a handler registration is always possible.
 * Per Phase 4.1's decision: this stays in-process for now; the Outbox
 * dispatcher (below) is the seam that becomes broker-backed later without
 * this dispatcher's callers ever changing.
 */
@Injectable()
export class DomainEventDispatcher {
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlers = new Map<string, EventHandler[]>();

  register(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const matched = this.handlers.get(event.type) ?? [];
    if (matched.length === 0) {
      this.logger.debug(`No handlers registered for event type: ${event.type}`);
      return;
    }
    // Independent subscribers (e.g. Audit, Reporting projector) must not
    // block or fail each other — one slow/broken projector should never
    // stop the audit trail from being written.
    const results = await Promise.allSettled(matched.map((h) => h(event)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        this.logger.error(
          `Handler ${i} failed for event ${event.type} (aggregate ${event.aggregateId})`,
          r.reason,
        );
      }
    });
  }
}