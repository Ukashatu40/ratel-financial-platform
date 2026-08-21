// test/unit/contexts/financial-period/financial-period.aggregate.spec.ts
import {
  FinancialPeriod,
  InvalidPeriodDatesError,
  PeriodReopenReasonRequiredError,
} from '../../../../src/contexts/financial-period/domain/aggregates/financial-period.aggregate';
import { InvalidStateTransitionError } from '../../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

function buildOpenPeriod() {
  return FinancialPeriod.create({
    organizationId: 'org-1',
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-31'),
  });
}

describe('FinancialPeriod aggregate', () => {
  it('rejects endDate before or equal to startDate', () => {
    expect(() =>
      FinancialPeriod.create({
        organizationId: 'org-1',
        startDate: new Date('2026-08-31'),
        endDate: new Date('2026-08-01'),
      }),
    ).toThrow(InvalidPeriodDatesError);

    expect(() =>
      FinancialPeriod.create({
        organizationId: 'org-1',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-01'),
      }),
    ).toThrow(InvalidPeriodDatesError);
  });

  it('starts in open status', () => {
    expect(buildOpenPeriod().status).toBe('open');
  });

  it('close() transitions open -> closed', () => {
    const period = buildOpenPeriod();
    period.close('closer-1');
    expect(period.status).toBe('closed');
    expect(period.isOpen()).toBe(false);
  });

  it('close() is allowed directly from open (skipping closing)', () => {
    const period = buildOpenPeriod();
    expect(() => period.close('closer-1')).not.toThrow();
  });

  it('rejects close() on an already-closed period', () => {
    const period = buildOpenPeriod();
    period.close('closer-1');
    expect(() => period.close('closer-1')).toThrow(InvalidStateTransitionError);
  });

  it('reopen() transitions closed -> reopened, and isOpen() becomes true again', () => {
    const period = buildOpenPeriod();
    period.close('closer-1');
    period.reopen('reopener-1', 'Late vendor invoice');
    expect(period.status).toBe('reopened');
    expect(period.isOpen()).toBe(true);
  });

  it('rejects reopen() on a period that was never closed', () => {
    const period = buildOpenPeriod();
    expect(() => period.reopen('reopener-1', 'Late vendor invoice')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('reopen() clears the close fields, so the period is genuinely open again', () => {
    const period = buildOpenPeriod();
    period.close('closer-1');
    expect(period.closedAt).not.toBeNull();

    period.reopen('reopener-1', 'Late vendor invoice');

    expect(period.closedAt).toBeNull();
    expect(period.toProps().closedById).toBeNull();
  });

  describe('reopen() requires a reason', () => {
    // The reason exists to be audited: AuditSubscriber lifts payload['reason']
    // into the audit entry, so reopening a closed financial period always leaves a
    // stated cause behind. A reason that can be blank would defeat that.
    const closedPeriod = () => {
      const period = buildOpenPeriod();
      period.close('closer-1');
      return period;
    };

    it('rejects an empty reason', () => {
      expect(() => closedPeriod().reopen('reopener-1', '')).toThrow(
        PeriodReopenReasonRequiredError,
      );
    });

    it('rejects a whitespace-only reason', () => {
      // class-validator's @IsNotEmpty considers '   ' present, so the DTO alone
      // would let this through — this trim is what actually closes the gap.
      expect(() => closedPeriod().reopen('reopener-1', '   \t\n ')).toThrow(
        PeriodReopenReasonRequiredError,
      );
    });

    it('does not transition when the reason is rejected', () => {
      // Order matters: a period must never be left reopened by a call that threw.
      const period = closedPeriod();
      expect(() => period.reopen('reopener-1', '')).toThrow();
      expect(period.status).toBe('closed');
      expect(period.isOpen()).toBe(false);
    });

    it('records the trimmed reason and the actor on the event', () => {
      const period = closedPeriod();
      period.pullDomainEvents(); // discard PeriodOpened/PeriodClosed

      period.reopen('reopener-1', '  Reversal of duplicated payment  ');

      const events = period.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PeriodReopened');
      expect(events[0].payload).toMatchObject({
        organizationId: 'org-1',
        reopenedById: 'reopener-1',
        reason: 'Reversal of duplicated payment',
      });
    });
  });
});
