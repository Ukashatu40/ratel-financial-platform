// src/contexts/payroll/payroll.module.ts
import { Module } from '@nestjs/common';
import { FinancialPeriodModule } from '../financial-period/financial-period.module';
import { PAYROLL_RUN_REPOSITORY } from './domain/ports/payroll-run-repository.port';
import { SALARY_STRUCTURE_REPOSITORY } from './domain/ports/salary-structure-repository.port';
import { PrismaPayrollRunRepository } from './infrastructure/persistence/prisma-payroll-run.repository';
import { PrismaSalaryStructureRepository } from './infrastructure/persistence/prisma-salary-structure.repository';
import { APPROVAL_POLICY } from '../../shared-kernel/workflow/approval-policy.port';
import { PayrollApprovalPolicy } from './infrastructure/policies/payroll-approval.policy';
import { APPROVAL_PROGRESS_REPOSITORY } from '../../shared-kernel/workflow/approval-progress-repository.port';
import { PrismaApprovalProgressRepository } from '../../shared-kernel/workflow/infrastructure/prisma-approval-progress.repository';
import { CreatePayrollRunHandler } from './application/handlers/create-payroll-run.handler';
import { AddPayslipHandler } from './application/handlers/add-payslip.handler';
import { SubmitPayrollRunHandler } from './application/handlers/submit-payroll-run.handler';
import { ApprovePayrollRunHandler } from './application/handlers/approve-payroll-run.handler';
import { RejectPayrollRunHandler } from './application/handlers/reject-payroll-run.handler';
import { ProcessPayrollRunHandler } from './application/handlers/process-payroll-run.handler';
import { CancelPayrollRunHandler } from './application/handlers/cancel-payroll-run.handler';
import { PayrollRunController } from './presentation/controllers/payroll-run.controller';

@Module({
  // Cross-context dependency, same shape as ExpenseModule's — pulling in
  // PERIOD_STATUS_PORT via the Open-Host Service (Phase 3.2), confirming
  // that seam serves a SECOND consumer cleanly, not just Expense.
  imports: [FinancialPeriodModule],
  controllers: [PayrollRunController],
  providers: [
    { provide: PAYROLL_RUN_REPOSITORY, useClass: PrismaPayrollRunRepository },
    { provide: SALARY_STRUCTURE_REPOSITORY, useClass: PrismaSalaryStructureRepository },
    { provide: APPROVAL_POLICY, useClass: PayrollApprovalPolicy },
    { provide: APPROVAL_PROGRESS_REPOSITORY, useClass: PrismaApprovalProgressRepository },
    CreatePayrollRunHandler,
    AddPayslipHandler,
    SubmitPayrollRunHandler,
    ApprovePayrollRunHandler,
    RejectPayrollRunHandler,
    ProcessPayrollRunHandler,
    CancelPayrollRunHandler,
  ],
  exports: [
    CreatePayrollRunHandler,
    AddPayslipHandler,
    SubmitPayrollRunHandler,
    ApprovePayrollRunHandler,
    RejectPayrollRunHandler,
    ProcessPayrollRunHandler,
    CancelPayrollRunHandler,
  ],
})
export class PayrollModule {}
