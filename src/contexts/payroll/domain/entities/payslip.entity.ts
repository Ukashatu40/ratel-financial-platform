// src/contexts/payroll/domain/entities/payslip.entity.ts
import { randomUUID } from 'crypto';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { SalaryLineItem } from '../value-objects/salary-line-item';
import { TaxComputation } from '../value-objects/tax-computation';

export interface PayslipProps {
  id: string;
  employeeId: string;
  salaryStructureSnapshot: Record<string, unknown>; // frozen JSON snapshot — see SalaryStructure below
  lineItems: SalaryLineItem[];
  taxComputation: TaxComputation;
  grossPay: Money;
  netPay: Money;
  createdAt: Date;
}

export class NetPayExceedsGrossPayError extends Error {
  constructor(employeeId: string) {
    super(`Computed net pay exceeds gross pay for employee ${employeeId} — check deduction totals`);
    this.name = 'NetPayExceedsGrossPayError';
  }
}

export class Payslip {
  private constructor(private props: PayslipProps) {}

  /**
   * Computes gross/net from the line items itself — callers never pass
   * gross/net directly, avoiding the class of bug where the stored total
   * silently drifts from what the line items actually sum to (the same
   * "numerically balanced but wrong" failure class from BED-6C, applied
   * here to payroll math instead of ledger entries).
   */
  static generate(input: {
    employeeId: string;
    salaryStructureSnapshot: Record<string, unknown>;
    lineItems: SalaryLineItem[];
    taxComputation: TaxComputation;
    currency: string;
  }): Payslip {
    const allowances = input.lineItems.filter((l) => l.kind === 'allowance');
    const deductions = input.lineItems.filter((l) => l.kind === 'deduction' || l.kind === 'loan_repayment');

    const grossPay = allowances.reduce((sum, item) => sum.add(item.amount), Money.zero(input.currency as any));
    const totalDeductions = deductions.reduce((sum, item) => sum.add(item.amount), Money.zero(input.currency as any));
    const netPay = grossPay.add(totalDeductions.negate()).add(input.taxComputation.computedTax.negate());

    if (netPay.minorUnits > grossPay.minorUnits) {
      throw new NetPayExceedsGrossPayError(input.employeeId);
    }

    return new Payslip({
      id: randomUUID(),
      employeeId: input.employeeId,
      salaryStructureSnapshot: input.salaryStructureSnapshot,
      lineItems: input.lineItems,
      taxComputation: input.taxComputation,
      grossPay,
      netPay,
      createdAt: new Date(),
    });
  }

  static reconstitute(props: PayslipProps): Payslip {
    return new Payslip(props);
  }

  get id(): string { return this.props.id; }
  get employeeId(): string { return this.props.employeeId; }
  get grossPay(): Money { return this.props.grossPay; }
  get netPay(): Money { return this.props.netPay; }

  toProps(): Readonly<PayslipProps> {
    return { ...this.props };
  }
}