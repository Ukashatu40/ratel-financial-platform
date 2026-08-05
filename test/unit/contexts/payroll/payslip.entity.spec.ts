// test/unit/contexts/payroll/payslip.entity.spec.ts
import {
  NetPayExceedsGrossPayError,
  Payslip,
} from '../../../../src/contexts/payroll/domain/entities/payslip.entity';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { noOpTaxComputation } from '../../../../src/contexts/payroll/domain/value-objects/tax-computation';
import { describe, expect, it } from '@jest/globals';

describe('Payslip entity', () => {
  describe('generate()', () => {
    it('computes gross pay as the sum of allowances only', () => {
      const payslip = Payslip.generate({
        employeeId: 'emp-1',
        salaryStructureSnapshot: {},
        lineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
          { kind: 'allowance', label: 'Housing', amount: Money.of(100000n, 'NGN') },
          { kind: 'deduction', label: 'Pension', amount: Money.of(24000n, 'NGN') },
        ],
        taxComputation: noOpTaxComputation('NGN'),
        currency: 'NGN',
      });

      expect(payslip.grossPay.minorUnits).toBe(400000n); // deductions excluded from gross
    });

    it('computes net pay as gross minus deductions minus tax', () => {
      const payslip = Payslip.generate({
        employeeId: 'emp-1',
        salaryStructureSnapshot: {},
        lineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(400000n, 'NGN') },
          { kind: 'deduction', label: 'Pension', amount: Money.of(24000n, 'NGN') },
        ],
        taxComputation: noOpTaxComputation('NGN'),
        currency: 'NGN',
      });

      expect(payslip.netPay.minorUnits).toBe(376000n); // matches the real seeded-data math from earlier testing
    });

    it('treats loan_repayment the same as deduction for net pay purposes', () => {
      const payslip = Payslip.generate({
        employeeId: 'emp-1',
        salaryStructureSnapshot: {},
        lineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(400000n, 'NGN') },
          { kind: 'loan_repayment', label: 'Staff Loan', amount: Money.of(50000n, 'NGN') },
        ],
        taxComputation: noOpTaxComputation('NGN'),
        currency: 'NGN',
      });

      expect(payslip.netPay.minorUnits).toBe(350000n);
    });

    it('throws NetPayExceedsGrossPayError if deductions would push net above gross', () => {
      // This scenario shouldn't be constructible through normal deduction
      // math (deductions only ever subtract), but the guard exists as a
      // defensive invariant check independent of how it's triggered.
      expect(() =>
        Payslip.generate({
          employeeId: 'emp-1',
          salaryStructureSnapshot: {},
          lineItems: [
            { kind: 'allowance', label: 'Base', amount: Money.of(100000n, 'NGN') },
            {
              kind: 'deduction',
              label: 'Negative deduction bug',
              amount: Money.of(-50000n, 'NGN'),
            },
          ],
          taxComputation: noOpTaxComputation('NGN'),
          currency: 'NGN',
        }),
      ).toThrow(NetPayExceedsGrossPayError);
    });

    it('produces zero gross/net when there are no line items at all', () => {
      const payslip = Payslip.generate({
        employeeId: 'emp-1',
        salaryStructureSnapshot: {},
        lineItems: [],
        taxComputation: noOpTaxComputation('NGN'),
        currency: 'NGN',
      });

      expect(payslip.grossPay.isZero()).toBe(true);
      expect(payslip.netPay.isZero()).toBe(true);
    });
  });
});
