// test/unit/reporting/payroll-summary.handler.spec.ts
import { PayrollSummaryHandler } from '../../../src/reporting/application/handlers/payroll-summary.handler';
import { PayrollSummaryQuery } from '../../../src/reporting/application/queries/payroll-summary.query';
import { it, expect, describe } from '@jest/globals';

function buildFakePrisma(findManyResult: any[] = []) {
  return { payrollRun: { findMany: jest.fn().mockResolvedValue(findManyResult) } };
}

describe('PayrollSummaryHandler', () => {
  it('filters by organizationId and runMonth within the given range', async () => {
    const prisma = buildFakePrisma([]);
    const handler = new PayrollSummaryHandler(prisma as any);
    const from = new Date('2026-08-01');
    const to = new Date('2026-08-31');

    await handler.execute(new PayrollSummaryQuery('org-1', from, to));

    const call = prisma.payrollRun.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      organizationId: 'org-1',
      runMonth: { gte: from, lte: to },
    });
  });

  it('sums gross and net pay across all payslips in a run', async () => {
    const prisma = buildFakePrisma([
      {
        runMonth: new Date('2026-08-01'),
        status: 'completed',
        payslips: [
          { grossPayMinorUnits: 400000n, netPayMinorUnits: 350000n },
          { grossPayMinorUnits: 600000n, netPayMinorUnits: 520000n },
        ],
      },
    ]);
    const handler = new PayrollSummaryHandler(prisma as any);

    const result = await handler.execute(
      new PayrollSummaryQuery('org-1', new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result).toEqual([
      {
        runMonth: '2026-08',
        status: 'completed',
        totalGrossMinorUnits: '1000000',
        totalNetMinorUnits: '870000',
        payslipCount: 2,
      },
    ]);
  });

  it('returns zero totals for a run with no payslips, rather than throwing', async () => {
    const prisma = buildFakePrisma([
      { runMonth: new Date('2026-08-01'), status: 'draft', payslips: [] },
    ]);
    const handler = new PayrollSummaryHandler(prisma as any);

    const result = await handler.execute(
      new PayrollSummaryQuery('org-1', new Date('2026-08-01'), new Date('2026-08-31')),
    );

    expect(result[0].totalGrossMinorUnits).toBe('0');
    expect(result[0].totalNetMinorUnits).toBe('0');
    expect(result[0].payslipCount).toBe(0);
  });

  it('returns one row per run, in ascending runMonth order (as the query requests)', async () => {
    const prisma = buildFakePrisma([
      { runMonth: new Date('2026-07-01'), status: 'completed', payslips: [] },
      { runMonth: new Date('2026-08-01'), status: 'approved', payslips: [] },
    ]);
    const handler = new PayrollSummaryHandler(prisma as any);

    const result = await handler.execute(
      new PayrollSummaryQuery('org-1', new Date('2026-07-01'), new Date('2026-08-31')),
    );

    expect(result.map((r) => r.runMonth)).toEqual(['2026-07', '2026-08']);
  });
});
