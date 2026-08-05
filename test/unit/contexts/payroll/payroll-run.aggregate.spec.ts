// test/unit/contexts/payroll/payroll-run.aggregate.spec.ts
import {
  DuplicatePayslipError,
  EmptyPayrollRunError,
  PayrollRun,
  PayrollRunNotMutableError,
} from '../../../../src/contexts/payroll/domain/aggregates/payroll-run.aggregate';
import { InvalidStateTransitionError } from '../../../../src/shared-kernel/errors/domain-error';
import { Payslip } from '../../../../src/contexts/payroll/domain/entities/payslip.entity';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { noOpTaxComputation } from '../../../../src/contexts/payroll/domain/value-objects/tax-computation';
import { describe, expect, it } from '@jest/globals';

function buildDraftRun() {
  return PayrollRun.create({
    organizationId: 'org-1',
    periodId: 'period-1',
    runMonth: new Date('2026-08-01'),
    createdById: 'payroll-admin-1',
  });
}

function buildPayslip(employeeId: string, grossMinorUnits = 400000n) {
  return Payslip.generate({
    employeeId,
    salaryStructureSnapshot: { version: 1 },
    lineItems: [
      { kind: 'allowance', label: 'Base Salary', amount: Money.of(grossMinorUnits, 'NGN') },
    ],
    taxComputation: noOpTaxComputation('NGN'),
    currency: 'NGN',
  });
}

describe('PayrollRun aggregate', () => {
  describe('create()', () => {
    it('starts in draft status', () => {
      expect(buildDraftRun().status).toBe('draft');
    });

    it('records a PayrollRunCreated event', () => {
      const run = buildDraftRun();
      const events = run.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PayrollRunCreated');
    });
  });

  describe('addPayslip()', () => {
    it('allows adding a payslip while draft', () => {
      const run = buildDraftRun();
      expect(() => run.addPayslip(buildPayslip('emp-1'))).not.toThrow();
      expect(run.getPayslips).toHaveLength(1);
    });

    it('records a PayslipGenerated event', () => {
      const run = buildDraftRun();
      run.pullDomainEvents(); // clear creation event
      run.addPayslip(buildPayslip('emp-1'));
      const events = run.pullDomainEvents();
      expect(events.map((e) => e.type)).toContain('PayslipGenerated');
    });

    it('rejects a duplicate payslip for the same employee', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      expect(() => run.addPayslip(buildPayslip('emp-1'))).toThrow(DuplicatePayslipError);
    });

    it('allows payslips for different employees', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      expect(() => run.addPayslip(buildPayslip('emp-2'))).not.toThrow();
      expect(run.getPayslips).toHaveLength(2);
    });

    it('rejects adding a payslip once the run is no longer draft', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      expect(() => run.addPayslip(buildPayslip('emp-2'))).toThrow(PayrollRunNotMutableError);
    });
  });

  describe('submitForApproval()', () => {
    it('rejects submission with zero payslips', () => {
      const run = buildDraftRun();
      expect(() => run.submitForApproval()).toThrow(EmptyPayrollRunError);
    });

    it('transitions draft -> pending_approval once at least one payslip exists', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      expect(run.status).toBe('pending_approval');
    });
  });

  describe('approve() / reject() / the confirmed reject-returns-to-draft design', () => {
    it('approve() transitions pending_approval -> approved', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      run.approve('finance-director-1');
      expect(run.status).toBe('approved');
    });

    it('reject() returns the run to draft, NOT a terminal rejected state', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      run.reject('finance-director-1', 'Missing employee data');
      expect(run.status).toBe('draft');
    });

    it('a rejected run can be resubmitted after correction', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      run.reject('finance-director-1', 'Fix needed');
      // back in draft -> can add another payslip and resubmit
      run.addPayslip(buildPayslip('emp-2'));
      expect(() => run.submitForApproval()).not.toThrow();
      expect(run.status).toBe('pending_approval');
    });
  });

  describe('processing lifecycle', () => {
    it('startProcessing() then complete() moves approved -> processing -> completed', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      run.approve('finance-director-1');
      run.startProcessing();
      expect(run.status).toBe('processing');
      run.complete();
      expect(run.status).toBe('completed');
    });

    it('rejects startProcessing() before approval', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      expect(() => run.startProcessing()).toThrow(InvalidStateTransitionError);
    });
  });

  describe('cancel()', () => {
    it('allows cancel() from draft', () => {
      const run = buildDraftRun();
      expect(() => run.cancel('admin-1')).not.toThrow();
      expect(run.status).toBe('cancelled');
    });

    it('rejects cancel() on an approved run', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1'));
      run.submitForApproval();
      run.approve('finance-director-1');
      expect(() => run.cancel('admin-1')).toThrow(InvalidStateTransitionError);
    });
  });

  describe('totalGrossPay()', () => {
    it('sums gross pay across all payslips in the run', () => {
      const run = buildDraftRun();
      run.addPayslip(buildPayslip('emp-1', 400000n));
      run.addPayslip(buildPayslip('emp-2', 600000n));
      expect(run.totalGrossPay('NGN').minorUnits).toBe(1000000n);
    });

    it('returns zero for a run with no payslips', () => {
      const run = buildDraftRun();
      expect(run.totalGrossPay('NGN').isZero()).toBe(true);
    });
  });
});
