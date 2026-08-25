// test/unit/shared-kernel/aggregate-diff.spec.ts
import { AggregateRoot, DomainEvent } from '../../../src/shared-kernel/events/domain-event';
import { canonicalStringify, toJsonSafe } from '../../../src/shared-kernel/serialization/canonical-json';
import { Money } from '../../../src/shared-kernel/money/money.vo';
import { describe, expect, it } from '@jest/globals';

/**
 * The generic field-level diff that fills the audit log's `old_value` column
 * (TECH_DEBT #8). Tested through a minimal stand-in aggregate rather than through
 * Expense/PayrollRun: the behaviour under test belongs to AggregateRoot, and using a
 * real aggregate would couple these assertions to that aggregate's own state machine.
 */
interface TestProps {
  id: string;
  status: string;
  amount: Money;
  closedAt: Date | null;
  closedById: string | null;
}

const event = (type: string): DomainEvent => ({
  type,
  aggregateType: 'TestThing',
  aggregateId: 'thing-1',
  occurredAt: new Date('2026-08-25T00:00:00.000Z'),
  payload: { organizationId: 'org-1' },
});

class TestThing extends AggregateRoot {
  private constructor(private props: TestProps) {
    super();
  }

  /** Mirrors a real create(): no baseline captured, so no diff on creation. */
  static create(): TestThing {
    return new TestThing({
      id: 'thing-1',
      status: 'open',
      amount: Money.of(1000n, 'NGN'),
      closedAt: null,
      closedById: null,
    });
  }

  /** Mirrors a real reconstitute(): captures the before-image. */
  static reconstitute(overrides: Partial<TestProps> = {}): TestThing {
    const thing = new TestThing({
      id: 'thing-1',
      status: 'open',
      amount: Money.of(1000n, 'NGN'),
      closedAt: null,
      closedById: null,
      ...overrides,
    });
    thing.captureBaseline();
    return thing;
  }

  protected snapshotState(): Record<string, unknown> {
    return { ...this.props };
  }

  // Mutate-then-record, the convention the diff depends on.
  close(closedById: string): void {
    this.props.status = 'closed';
    this.props.closedAt = new Date('2026-09-01T00:00:00.000Z');
    this.props.closedById = closedById;
    this.recordEvent(event('Closed'));
  }

  reopen(): void {
    this.props.status = 'reopened';
    this.props.closedAt = null;
    this.props.closedById = null;
    this.recordEvent(event('Reopened'));
  }

  changeAmount(amount: Money): void {
    this.props.amount = amount;
    this.recordEvent(event('AmountChanged'));
  }

  /** Records an event without touching props — like PayrollRun.addPayslip. */
  touchNothing(): void {
    this.recordEvent(event('NothingChanged'));
  }

  recordCreation(): void {
    this.recordEvent(event('Created'));
  }
}

const changesOf = (thing: TestThing): Record<string, { from: unknown; to: unknown }> | undefined => {
  const [recorded] = thing.pullDomainEvents();
  return recorded.payload['changes'] as Record<string, { from: unknown; to: unknown }> | undefined;
};

describe('AggregateRoot field-level diff (TECH_DEBT #8)', () => {
  it('reports only the fields that actually changed', () => {
    const thing = TestThing.reconstitute();
    thing.close('user-1');

    const changes = changesOf(thing);

    expect(changes).toEqual({
      status: { from: 'open', to: 'closed' },
      closedAt: { from: null, to: '2026-09-01T00:00:00.000Z' },
      closedById: { from: null, to: 'user-1' },
    });
    // Unchanged fields must be absent entirely, not present with from === to —
    // otherwise old_value would imply every field was rewritten on every action.
    expect(changes).not.toHaveProperty('id');
    expect(changes).not.toHaveProperty('amount');
  });

  it('records NO changes for a create(), so old_value stays NULL', () => {
    // A newly created aggregate has no before-state. "Nothing existed before" is the
    // honest record; a diff against an imaginary empty row would be a fabrication.
    const thing = TestThing.create();
    thing.recordCreation();

    expect(changesOf(thing)).toBeUndefined();
  });

  it('records no changes when an event does not touch props (PayrollRun.addPayslip case)', () => {
    // The payload must be left alone rather than given an empty `changes: {}`, which
    // would imply a diff was computed and legitimately came back empty.
    const thing = TestThing.reconstitute();
    thing.touchNothing();

    expect(changesOf(thing)).toBeUndefined();
  });

  it('diffs a second mutation against the intermediate state, not the original', () => {
    // The baseline advances at every recordEvent. Without that, a reopen following a
    // close in the same unit of work would report `status: open -> reopened`, hiding
    // that the period passed through `closed` — and the audit trail would be wrong
    // about what actually happened.
    const thing = TestThing.reconstitute();

    thing.close('user-1');
    thing.reopen();

    const events = thing.pullDomainEvents();
    expect(events).toHaveLength(2);

    expect(events[0].payload['changes']).toMatchObject({
      status: { from: 'open', to: 'closed' },
    });
    expect(events[1].payload['changes']).toMatchObject({
      status: { from: 'closed', to: 'reopened' },
      closedById: { from: 'user-1', to: null },
    });
  });

  it('normalizes Money through its toJSON rather than leaking private fields', () => {
    const thing = TestThing.reconstitute();
    thing.changeAmount(Money.of(250000n, 'NGN'));

    const changes = changesOf(thing);

    // minorUnits as a STRING: bigint has no JSON representation, and Number() would
    // silently lose precision on a large amount (critical convention #1).
    expect(changes).toEqual({
      amount: {
        from: { minorUnits: '1000', currency: 'NGN' },
        to: { minorUnits: '250000', currency: 'NGN' },
      },
    });
  });

  it('does not report a change when a value is structurally equal', () => {
    // Money is a fresh instance each time, so reference equality would report a
    // spurious change here. The diff compares canonically for exactly this reason.
    const thing = TestThing.reconstitute();
    thing.changeAmount(Money.of(1000n, 'NGN'));

    expect(changesOf(thing)).toBeUndefined();
  });

  it('leaves the rest of the event payload untouched', () => {
    const thing = TestThing.reconstitute();
    thing.close('user-1');

    const [recorded] = thing.pullDomainEvents();
    expect(recorded.payload['organizationId']).toBe('org-1');
    expect(recorded.type).toBe('Closed');
    expect(recorded.aggregateId).toBe('thing-1');
  });
});

describe('canonical JSON', () => {
  it('produces identical strings for objects whose keys were built in different orders', () => {
    // The property hash v2 depends on: jsonb returns keys in its own order, so a
    // verifier recomputing a hash from the database must serialize identically.
    const a = { status: 'closed', closedById: 'user-1', nested: { b: 2, a: 1 } };
    const b = { nested: { a: 1, b: 2 }, closedById: 'user-1', status: 'closed' };

    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array order, which is meaningful data', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it('converts Date to an ISO string and bigint to a decimal string', () => {
    expect(toJsonSafe(new Date('2026-08-25T12:00:00.000Z'))).toBe('2026-08-25T12:00:00.000Z');
    // As a string, not a number: JSON.stringify throws on bigint, and Number()
    // would lose precision beyond 2^53.
    expect(toJsonSafe(9007199254740993n)).toBe('9007199254740993');
  });

  it('treats undefined and null alike, as jsonb cannot distinguish them', () => {
    expect(toJsonSafe(undefined)).toBeNull();
    expect(toJsonSafe(null)).toBeNull();
  });

  it('prefers toJSON when a value object exposes one', () => {
    expect(toJsonSafe(Money.of(500n, 'USD'))).toEqual({ minorUnits: '500', currency: 'USD' });
  });

  it('replaces non-finite numbers with null, which is all JSON can represent', () => {
    expect(toJsonSafe(Number.NaN)).toBeNull();
    expect(toJsonSafe(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
