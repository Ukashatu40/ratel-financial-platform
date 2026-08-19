// test/unit/contexts/payroll/get-payroll-run-by-id.handler.spec.ts
import { GetPayrollRunByIdHandler } from '../../../../src/contexts/payroll/application/handlers/get-payroll-run-by-id.handler';
import { GetPayrollRunByIdQuery } from '../../../../src/contexts/payroll/application/queries/get-payroll-run-by-id.query';
import { PayrollRun } from '../../../../src/contexts/payroll/domain/aggregates/payroll-run.aggregate';
import { Payslip } from '../../../../src/contexts/payroll/domain/entities/payslip.entity';
import { noOpTaxComputation } from '../../../../src/contexts/payroll/domain/value-objects/tax-computation';
import { EntityNotFoundError } from '../../../../src/shared-kernel/errors/domain-error';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { describe, expect, it } from '@jest/globals';

function buildPayslip(employeeId: string) {
  return Payslip.generate({
    employeeId,
    salaryStructureSnapshot: { basic: 400000 },
    lineItems: [
      { kind: 'allowance', label: 'Base', amount: Money.of(400000n, 'NGN') },
      { kind: 'deduction', label: 'Pension', amount: Money.of(24000n, 'NGN') },
    ],
    taxComputation: noOpTaxComputation('NGN'),
    currency: 'NGN',
  });
}

function buildRun(organizationId = 'org-1', employeeIds: string[] = ['emp-1']) {
  const run = PayrollRun.create({
    organizationId,
    periodId: 'period-1',
    runMonth: new Date('2026-08-01'),
    createdById: 'user-1',
  });
  employeeIds.forEach((id) => run.addPayslip(buildPayslip(id)));
  return run;
}

function buildHandler(run: PayrollRun | null) {
  const repo = { findById: jest.fn().mockResolvedValue(run) };
  return { handler: new GetPayrollRunByIdHandler(repo as any), repo };
}

describe('GetPayrollRunByIdHandler', () => {
  it('returns the run props with one projected entry per payslip', async () => {
    const run = buildRun('org-1', ['emp-1', 'emp-2']);
    const { handler } = buildHandler(run);

    const result = await handler.execute(new GetPayrollRunByIdQuery(run.id, 'org-1'));

    expect(result.id).toBe(run.id);
    expect(result.status).toBe('draft');
    expect(result.payslips).toHaveLength(2);
  });

  it('projects each payslip to identity + totals, never an undefined entry', async () => {
    // The regression this test exists for: the map callback used a block body
    // with labeled statements and no `return`, so every entry was `undefined`
    // and the endpoint served `payslips: [undefined, undefined]`. It compiled
    // and shipped because the handler's return type was `any`.
    const run = buildRun('org-1', ['emp-1']);
    const { handler } = buildHandler(run);

    const result = await handler.execute(new GetPayrollRunByIdQuery(run.id, 'org-1'));

    const [payslip] = result.payslips;
    expect(payslip).toBeDefined();
    expect(payslip.employeeId).toBe('emp-1');
    expect(payslip.id).toBe(run.getPayslips[0].id);
    // Money serialized as MoneyJSON — bigint as string, never a float
    expect(payslip.grossPay).toEqual({ minorUnits: '400000', currency: 'NGN' });
    expect(payslip.netPay).toEqual({ minorUnits: '376000', currency: 'NGN' });
  });

  it('omits line items, tax computation and the salary snapshot from each payslip', async () => {
    // A narrow projection for its own sake, not a second authorization tier —
    // asserted so a future widening of the response is a deliberate change to
    // this expectation rather than an accident.
    const run = buildRun('org-1', ['emp-1']);
    const { handler } = buildHandler(run);

    const result = await handler.execute(new GetPayrollRunByIdQuery(run.id, 'org-1'));

    expect(Object.keys(result.payslips[0]).sort()).toEqual([
      'employeeId',
      'grossPay',
      'id',
      'netPay',
    ]);
  });

  it('returns an empty payslips array for a run with no payslips', async () => {
    const run = buildRun('org-1', []);
    const { handler } = buildHandler(run);

    const result = await handler.execute(new GetPayrollRunByIdQuery(run.id, 'org-1'));

    expect(result.payslips).toEqual([]);
  });

  it('throws EntityNotFoundError when the run does not exist', async () => {
    const { handler } = buildHandler(null);

    await expect(
      handler.execute(new GetPayrollRunByIdQuery('missing-id', 'org-1')),
    ).rejects.toThrow(EntityNotFoundError);
  });

  it('throws EntityNotFoundError when the run belongs to a DIFFERENT organization', async () => {
    // Payroll is the most sensitive data in the system — a leaked/guessed ID
    // from another org must 404, not 200 with someone else's payslips.
    const run = buildRun('org-OTHER');
    const { handler } = buildHandler(run);

    await expect(handler.execute(new GetPayrollRunByIdQuery(run.id, 'org-1'))).rejects.toThrow(
      EntityNotFoundError,
    );
  });
});
