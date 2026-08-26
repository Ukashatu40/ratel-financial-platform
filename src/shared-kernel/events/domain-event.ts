// src/shared-kernel/events/domain-event.ts
// src/shared-kernel/events/domain-event.ts
import { canonicalStringify, JsonValue, toJsonSafe } from '../serialization/canonical-json';

export interface DomainEvent {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;

  // Populated ONLY by OutboxDispatchService when reconstructing an event
  // from its persisted outbox row — domain/aggregate code (AggregateRoot,
  // Expense, PayrollRun, etc.) never sets these. Optional specifically so
  // domain code creating events (via expenseApproved(), etc.) doesn't need
  // to know these fields exist at all.
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly source?: string;
}
/**
 * One field's before/after values, as recorded on an event's `changes` payload key.
 * Both sides are already JSON-safe (Dates as ISO strings, Money via its toJSON).
 */
export interface FieldChange {
  from: JsonValue;
  to: JsonValue;
}

/**
 * Base class every aggregate root extends to get event-recording for free.
 * Handlers call pullDomainEvents() after invoking a mutating method — this
 * is what makes events derive FROM the state change rather than being
 * constructed separately and risking drift (Phase 5.2).
 *
 * Also computes the field-level before/after diff that fills the audit log's
 * `old_value` column (TECH_DEBT #8). Done generically HERE, once, rather than by
 * threading an explicit diff through every mutating method on every aggregate —
 * the same Conformist reasoning that lets `AuditSubscriber` audit every event with
 * zero per-context code.
 *
 * This works because of a convention every aggregate already follows: mutating
 * methods assign to `this.props` BEFORE calling `recordEvent`. Verified across all
 * 13 recordEvent call sites in Expense, PayrollRun and FinancialPeriod. A method
 * that recorded its event first would silently produce an empty diff, so keep
 * mutate-then-record.
 */
export abstract class AggregateRoot {
  private domainEvents: DomainEvent[] = [];

  /**
   * State as of the last recorded event (or of load, before any mutation).
   * `null` means "no baseline" — see captureBaseline.
   */
  private baselineState: Record<string, JsonValue> | null = null;

  /**
   * Serializable snapshot of this aggregate's own state. Every implementation is
   * `return this.toProps()`.
   *
   * Abstract rather than defaulting to `{}` on purpose: a new aggregate must decide
   * consciously, instead of silently contributing no diff and leaving a gap in the
   * audit trail that nothing would flag.
   */
  protected abstract snapshotState(): Record<string, unknown>;

  /**
   * Records the current state as the before-image for subsequent diffs. Called from
   * each aggregate's `reconstitute()`.
   *
   * NOT called from the base constructor, which cannot work: a subclass assigns
   * `this.props` AFTER `super()` returns, so a constructor-time snapshot would read
   * `undefined`.
   *
   * NOT called from `create()` either, and that is deliberate rather than an
   * oversight — a newly created aggregate has no before-state, so its creation event
   * carries no `changes` and its audit entry's `old_value` stays NULL. "Nothing
   * existed before" is the honest record, not a diff against an imaginary empty row.
   */
  protected captureBaseline(): void {
    this.baselineState = this.normalizedState();
  }

  protected recordEvent(event: DomainEvent): void {
    const changes = this.diffAgainstBaseline();
    this.domainEvents.push(
      // DomainEvent's fields are readonly, so this rebuilds rather than assigns.
      // Events with no field changes (e.g. PayrollRun.addPayslip, which mutates a
      // child collection rather than props) keep their payload untouched — no empty
      // `changes: {}` key implying a diff was computed and came back empty.
      changes ? { ...event, payload: { ...event.payload, changes } } : event,
    );
  }

  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEvents;
    this.domainEvents = [];
    return events;
  }

  private normalizedState(): Record<string, JsonValue> {
    const snapshot = toJsonSafe(this.snapshotState());
    // snapshotState returns an object, so toJsonSafe returns one too; the guard is
    // for a subclass that returns something unexpected rather than a real branch.
    return snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot
      : {};
  }

  private diffAgainstBaseline(): Record<string, FieldChange> | null {
    if (this.baselineState === null) return null;

    const current = this.normalizedState();
    const changes: Record<string, FieldChange> = {};

    // Union of both key sets, so a field appearing or disappearing counts as a change
    // rather than being missed by iterating only one side.
    for (const key of new Set([...Object.keys(this.baselineState), ...Object.keys(current)])) {
      const from = this.baselineState[key] ?? null;
      const to = current[key] ?? null;
      // Compared canonically: two structurally equal objects must not read as a
      // change just because their keys were built in a different order.
      if (canonicalStringify(from) !== canonicalStringify(to)) {
        changes[key] = { from, to };
      }
    }

    // Advance the baseline unconditionally, including when nothing changed, so a
    // second mutation in the same unit of work diffs against the intermediate state
    // rather than re-reporting the first mutation's fields.
    this.baselineState = current;

    return Object.keys(changes).length > 0 ? changes : null;
  }
}
