// src/shared-kernel/events/domain-event-dispatcher.ts
import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from './domain-event';

type EventHandler = (event: DomainEvent) => Promise<void>;

interface RegisteredSubscriber {
  /**
   * Stable, human-meaningful identity. Deliberately a string literal at each
   * registration site rather than `SomeClass.name`: this value is PERSISTED
   * (as `failed_event_deliveries.subscriber_name`) and used as the key to
   * redeliver to one specific subscriber. Deriving it from a class name would
   * mean a later class rename silently orphans every stored retry row.
   */
  name: string;
  handler: EventHandler;
}

export interface SubscriberFailure {
  subscriberName: string;
  error: unknown;
}

export interface DispatchResult {
  /** How many subscribers were invoked, successfully or not. */
  invoked: number;
  /** Empty means every subscriber succeeded. */
  failures: SubscriberFailure[];
}

/**
 * Wiring/programming errors, not business-rule errors, so these are bare
 * `Error`s rather than `DomainError`s — deliberately, and NOT the same mistake
 * TECH_DEBT #24 fixed. That item was about errors which reach an HTTP response
 * and so need `ProblemDetailsFilter` to render them. These two can only be
 * raised at module init (duplicate registration) or inside a background worker
 * (redelivery to a subscriber that no longer exists); neither has an HTTP
 * response to render into. `CsvParseError` is a bare Error for the same reason.
 */
export class DuplicateSubscriberNameError extends Error {
  constructor(name: string, eventType: string) {
    super(
      `Subscriber name "${name}" is already registered for event type "${eventType}". ` +
        'Names must be unique per event type — they are the key used to redeliver a failed event ' +
        'to one specific subscriber, so a duplicate would make redelivery ambiguous.',
    );
    this.name = 'DuplicateSubscriberNameError';
  }
}

export class UnknownSubscriberError extends Error {
  constructor(subscriberName: string, eventType: string) {
    super(
      `No subscriber named "${subscriberName}" is registered for event type "${eventType}" — ` +
        'it may have been renamed or removed since this delivery failure was recorded.',
    );
    this.name = 'UnknownSubscriberError';
  }
}

/**
 * In-process pub/sub, deliberately explicit (no NestJS EventEmitter magic
 * strings) so `grep`-ing a handler registration is always possible.
 * Per Phase 4.1's decision: this stays in-process for now; the Outbox
 * dispatcher is the seam that becomes broker-backed later without this
 * dispatcher's callers ever changing.
 *
 * `dispatch()` still isolates subscribers from each other with
 * `Promise.allSettled` — one failing subscriber must never prevent the others
 * from running. What changed for TECH_DEBT #9 is that it no longer SWALLOWS
 * those failures: it returns them, named, so the caller can persist and
 * redrive them. Previously a failure was logged as `Handler 2` — an index into
 * a runtime array, which is unusable both as a diagnostic and as a retry key.
 */
@Injectable()
export class DomainEventDispatcher {
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlers = new Map<string, RegisteredSubscriber[]>();
  private readonly globalSubscribers: RegisteredSubscriber[] = [];

  register(eventType: string, handler: EventHandler, subscriberName: string): void {
    const existing = this.handlers.get(eventType) ?? [];

    // Fail at boot, not at redelivery time: an ambiguous name is only
    // discoverable much later otherwise, when a retry picks the wrong handler.
    if (existing.some((s) => s.name === subscriberName)) {
      throw new DuplicateSubscriberNameError(subscriberName, eventType);
    }
    if (this.globalSubscribers.some((s) => s.name === subscriberName)) {
      throw new DuplicateSubscriberNameError(subscriberName, eventType);
    }

    existing.push({ name: subscriberName, handler });
    this.handlers.set(eventType, existing);
  }

  /**
   * Registers a subscriber that receives EVERY dispatched event, regardless of
   * type — the concrete mechanism for a Conformist subscriber (Phase 3.5).
   * Audit is the only current consumer; Reporting projectors use type-specific
   * register() instead, since each projection cares about specific event shapes.
   */
  registerGlobal(handler: EventHandler, subscriberName: string): void {
    if (this.globalSubscribers.some((s) => s.name === subscriberName)) {
      throw new DuplicateSubscriberNameError(subscriberName, '*');
    }
    this.globalSubscribers.push({ name: subscriberName, handler });
  }

  async dispatch(event: DomainEvent): Promise<DispatchResult> {
    const subscribers = this.subscribersFor(event);

    if (subscribers.length === 0) {
      this.logger.debug(`No handlers registered for event type: ${event.type}`);
      return { invoked: 0, failures: [] };
    }

    const results = await Promise.allSettled(subscribers.map((s) => s.handler(event)));

    const failures: SubscriberFailure[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const subscriberName = subscribers[i].name;
        failures.push({ subscriberName, error: result.reason });
        this.logger.error(
          `Subscriber "${subscriberName}" failed for event ${event.type} (aggregate ${event.aggregateId})`,
          result.reason,
        );
      }
    });

    return { invoked: subscribers.length, failures };
  }

  /**
   * Redelivers ONE event to ONE named subscriber — the retry primitive.
   *
   * Per-subscriber rather than per-event on purpose: re-dispatching a whole
   * event to redrive a single failed subscriber would re-run the ones that
   * already succeeded, and `NotificationSubscriber` enqueues email, so that
   * would send duplicates.
   *
   * Resolves the handler from the subscribers registered for THIS event's type
   * (falling through to globals), so it re-invokes exactly the handler the
   * event would originally have reached. Deliberately does not catch: the
   * caller owns retry/backoff and needs the throw to drive it.
   */
  async dispatchTo(subscriberName: string, event: DomainEvent): Promise<void> {
    const target = this.subscribersFor(event).find((s) => s.name === subscriberName);
    if (!target) throw new UnknownSubscriberError(subscriberName, event.type);
    await target.handler(event);
  }

  private subscribersFor(event: DomainEvent): RegisteredSubscriber[] {
    return [...(this.handlers.get(event.type) ?? []), ...this.globalSubscribers];
  }
}
