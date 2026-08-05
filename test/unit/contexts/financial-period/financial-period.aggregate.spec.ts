// test/unit/contexts/financial-period/financial-period.aggregate.spec.ts
import {
  FinancialPeriod,
  InvalidPeriodDatesError,
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
    period.reopen('reopener-1');
    expect(period.status).toBe('reopened');
    expect(period.isOpen()).toBe(true);
  });

  it('rejects reopen() on a period that was never closed', () => {
    const period = buildOpenPeriod();
    expect(() => period.reopen('reopener-1')).toThrow(InvalidStateTransitionError);
  });
});
