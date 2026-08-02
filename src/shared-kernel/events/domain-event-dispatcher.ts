// src/shared-kernel/events/domain-event-dispatcher.ts  (replace entire file)
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
  private readonly globalHandlers: EventHandler[] = [];

  register(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Registers a handler that receives EVERY dispatched event, regardless of
   * type — the concrete mechanism for a Conformist subscriber (Phase 3.5).
   * Audit is the only current consumer; Reporting projectors will use
   * type-specific register() instead, since each projection cares about
   * specific event shapes.
   */
  registerGlobal(handler: EventHandler): void {
    this.globalHandlers.push(handler);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const typedHandlers = this.handlers.get(event.type) ?? [];
    const allHandlers = [...typedHandlers, ...this.globalHandlers];

    if (allHandlers.length === 0) {
      this.logger.debug(`No handlers registered for event type: ${event.type}`);
      return;
    }

    const results = await Promise.allSettled(allHandlers.map((h) => h(event)));
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
