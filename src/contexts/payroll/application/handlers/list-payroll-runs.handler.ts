// src/contexts/payroll/application/handlers/list-payroll-runs.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { decodeCursor, Page } from '../../../../shared-kernel/pagination/cursor';
import {
  PAYROLL_RUN_REPOSITORY,
  PayrollRunRepository,
} from '../../domain/ports/payroll-run-repository.port';
import { ListPayrollRunsQuery } from '../queries/list-payroll-runs.query';
import { PayrollRunProps } from '../../domain/aggregates/payroll-run.aggregate';

export interface PayrollRunSummaryView {
  id: string;
  status: PayrollRunProps['status'];
  runMonth: Date;
  payslipCount: number;
}

@Injectable()
export class ListPayrollRunsHandler implements QueryHandler<
  ListPayrollRunsQuery,
  Page<PayrollRunSummaryView>
> {
  constructor(@Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository) {}

  async execute(query: ListPayrollRunsQuery): Promise<Page<PayrollRunSummaryView>> {
    const page = await this.repo.findMany({
      organizationId: query.organizationId,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit,
    });

    return {
      data: page.data.map((run): PayrollRunSummaryView => {
        const props = run.toProps();
        return {
          id: props.id,
          status: props.status,
          runMonth: props.runMonth,
          payslipCount: run.getPayslips.length,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }
}
