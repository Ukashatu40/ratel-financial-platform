// src/contexts/payroll/application/handlers/add-payslip.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError, PeriodClosedError } from '../../../../shared-kernel/errors/domain-error';
import { PERIOD_STATUS_PORT, PeriodStatusPort } from '../../../../shared-kernel/period-status/period-status.port';
import { PAYROLL_RUN_REPOSITORY, PayrollRunRepository } from '../../domain/ports/payroll-run-repository.port';
import {
  SALARY_STRUCTURE_REPOSITORY,
  SalaryStructureRepository,
} from '../../domain/ports/salary-structure-repository.port';
import { Payslip } from '../../domain/entities/payslip.entity';
import { noOpTaxComputation } from '../../domain/value-objects/tax-computation';
import { AddPayslipCommand } from '../commands/add-payslip.command';

// NGN hardcoded for v1 per Phase 1's initial scope (NGN only, multi-currency
// payroll deferred) — this is the one place that assumption is made
// explicit rather than silently baked into arithmetic elsewhere.
const DEFAULT_CURRENCY = 'NGN';

@Injectable()
export class AddPayslipHandler implements CommandHandler<AddPayslipCommand, { payslipId: string }> {
  constructor(
    @Inject(PAYROLL_RUN_REPOSITORY) private readonly runRepo: PayrollRunRepository,
    @Inject(SALARY_STRUCTURE_REPOSITORY) private readonly salaryRepo: SalaryStructureRepository,
    @Inject(PERIOD_STATUS_PORT) private readonly periodStatus: PeriodStatusPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: AddPayslipCommand): Promise<{ payslipId: string }> {
    return this.uow.transaction(async (tx) => {
      const run = await this.runRepo.findById(cmd.payrollRunId, tx);
      if (!run || run.organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('PayrollRun', cmd.payrollRunId);
      }

      const isOpen = await this.periodStatus.isOpen(cmd.organizationId, run.periodId);
      if (!isOpen) throw new PeriodClosedError(run.periodId);

      const structure = await this.salaryRepo.findActiveForEmployee(cmd.employeeId, tx);
      if (!structure) throw new EntityNotFoundError('SalaryStructure', cmd.employeeId);

      const payslip = Payslip.generate({
        employeeId: cmd.employeeId,
        salaryStructureSnapshot: structure.toSnapshot(),
        lineItems: [...structure.baseSalaryLineItems, ...cmd.additionalLineItems],
        taxComputation: noOpTaxComputation(DEFAULT_CURRENCY),
        currency: DEFAULT_CURRENCY,
      });

      // addPayslip() enforces mutability (draft-only) and duplicate-employee
      // rules itself (Phase 2.4/piece 1) — this handler just orchestrates.
      run.addPayslip(payslip);

      await this.runRepo.save(run, tx);
      await this.outbox.enqueue(run.pullDomainEvents(), tx);

      return { payslipId: payslip.id };
    });
  }
}