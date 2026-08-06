// src/contexts/payroll/application/handlers/get-payroll-run-by-id.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  PAYROLL_RUN_REPOSITORY,
  PayrollRunRepository,
} from '../../domain/ports/payroll-run-repository.port';
import { GetPayrollRunByIdQuery } from '../queries/get-payroll-run-by-id.query';

@Injectable()
export class GetPayrollRunByIdHandler implements QueryHandler<GetPayrollRunByIdQuery, any> {
  constructor(@Inject(PAYROLL_RUN_REPOSITORY) private readonly repo: PayrollRunRepository) {}

  async execute(query: GetPayrollRunByIdQuery) {
    const run = await this.repo.findById(query.runId);
    if (!run || run.organizationId !== query.organizationId) {
      throw new EntityNotFoundError('PayrollRun', query.runId);
    }

    const props = run.toProps();
    return {
      ...props,
      payslips: run.getPayslips.map((p) => {
        const pProps = p.toProps();
        // Deliberately returning gross/net (plaintext columns) but NOT the
        // decrypted line-item breakdown here — full detail requires
        // separately proving 'payroll:view_sensitive' intent at the line-item
        // level, not just the ability to see that a run/payslip exists.
        // Flagging this as a design choice worth confirming, not an oversight:
        // right now BOTH this summary view and full detail sit behind the
        // SAME permission (payroll:view_sensitive), so the distinction drawn
        // here isn't actually enforced differently yet — it's shaped for a
        // future two-tier split that doesn't exist. Tracked in TECH_DEBT.
        employeeId: pProps.employeeId;
        grossPay: pProps.grossPay.toJSON();
        netPay: pProps.netPay.toJSON();
      }),
    };
  }
}
