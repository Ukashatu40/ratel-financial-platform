// src/reporting/application/handlers/payroll-summary.handler.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PayrollSummaryQuery } from '../queries/payroll-summary.query';

export interface PayrollSummaryRow {
  runMonth: string;
  status: string;
  totalGrossMinorUnits: string;
  totalNetMinorUnits: string;
  payslipCount: number;
}

@Injectable()
export class PayrollSummaryHandler implements QueryHandler<
  PayrollSummaryQuery,
  PayrollSummaryRow[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: PayrollSummaryQuery): Promise<PayrollSummaryRow[]> {
    // Queries plaintext gross/net columns directly — no decryption needed,
    // per the deliberate design from Phase 6.2/9.3 that kept these two
    // columns unencrypted specifically so reporting never has to touch
    // the encrypted line-item detail.
    const runs = await this.prisma.payrollRun.findMany({
      where: { organizationId: query.organizationId, runMonth: { gte: query.from, lte: query.to } },
      include: { payslips: { select: { grossPayMinorUnits: true, netPayMinorUnits: true } } },
      orderBy: { runMonth: 'asc' },
    });

    return runs.map((run) => {
      const totalGross = run.payslips.reduce((sum, p) => sum + p.grossPayMinorUnits, 0n);
      const totalNet = run.payslips.reduce((sum, p) => sum + p.netPayMinorUnits, 0n);
      return {
        runMonth: run.runMonth.toISOString().slice(0, 7),
        status: run.status,
        totalGrossMinorUnits: totalGross.toString(),
        totalNetMinorUnits: totalNet.toString(),
        payslipCount: run.payslips.length,
      };
    });
  }
}
