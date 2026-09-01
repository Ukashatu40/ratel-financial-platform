// src/contexts/payroll/application/handlers/get-payroll-run-by-id.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import { MoneyJSON } from '../../../../shared-kernel/money/money.vo';
import { PayrollRunStatusValue } from '../../domain/value-objects/payroll-run-status';
import {
  PAYROLL_RUN_REPOSITORY,
  PayrollRunRepository,
} from '../../domain/ports/payroll-run-repository.port';
import { GetPayrollRunByIdQuery } from '../queries/get-payroll-run-by-id.query';

export interface PayrollRunPayslipView {
  id: string;
  employeeId: string;
  grossPay: MoneyJSON;
  netPay: MoneyJSON;
}

export interface PayrollRunDetailView {
  id: string;
  organizationId: string;
  periodId: string;
  status: PayrollRunStatusValue;
  runMonth: Date;
  createdById: string;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  payslips: PayrollRunPayslipView[];
}

@Injectable()
export class GetPayrollRunByIdHandler implements QueryHandler<
  GetPayrollRunByIdQuery,
  PayrollRunDetailView
> {
  constructor(@Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository) {}

  async execute(query: GetPayrollRunByIdQuery): Promise<PayrollRunDetailView> {
    const run = await this.repo.findById(query.runId);
    if (!run || run.organizationId !== query.organizationId) {
      throw new EntityNotFoundError('PayrollRun', query.runId);
    }

    const props = run.toProps();
    return {
      ...props,
      // Each payslip is projected down to identity + totals. This is a
      // narrow projection for its own sake — the same discipline as
      // `ColumnMappingView` — NOT a second authorization tier: this endpoint
      // and any future full-detail one would both sit behind
      // `payroll:view_sensitive` today, so nothing here is enforced
      // differently from anything else that permission already unlocks.
      //
      // Line items, the tax computation and the frozen salary-structure
      // snapshot are omitted because no caller needs them to list or review
      // a run. If full line-item detail is ever required, it belongs on a
      // separate endpoint — and THAT is the point at which "does full detail
      // need a stricter permission than the summary?" becomes a real
      // decision to make, rather than one this response shape merely hints at.
      payslips: run.getPayslips.map((payslip): PayrollRunPayslipView => {
        const p = payslip.toProps();
        return {
          id: p.id,
          employeeId: p.employeeId,
          grossPay: p.grossPay.toJSON(),
          netPay: p.netPay.toJSON(),
        };
      }),
    };
  }
}
