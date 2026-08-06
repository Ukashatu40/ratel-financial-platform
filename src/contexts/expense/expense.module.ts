// src/contexts/expense/expense.module.ts
import { Module } from '@nestjs/common';
import { FinancialPeriodModule } from '../financial-period/financial-period.module';
import { EXPENSE_REPOSITORY } from './domain/ports/expense-repository.port';
import { PrismaExpenseRepository } from './infrastructure/persistence/prisma-expense.repository';
import { ExpenseApprovalPolicy } from './infrastructure/policies/expense-approval.policy';
import { ExpenseAdjustmentApprovalPolicy } from './infrastructure/policies/expense-adjustment-approval.policy';
import { APPROVAL_POLICY } from '../../shared-kernel/workflow/approval-policy.port';
import { ADJUSTMENT_APPROVAL_POLICY } from '../../shared-kernel/workflow/adjustment-approval-policy.port';
import { APPROVAL_PROGRESS_REPOSITORY } from '../../shared-kernel/workflow/approval-progress-repository.port';
import { PrismaApprovalProgressRepository } from '../../shared-kernel/workflow/infrastructure/prisma-approval-progress.repository';
import { CreateExpenseHandler } from './application/handlers/create-expense.handler';
import { SubmitExpenseHandler } from './application/handlers/submit-expense.handler';
import { ApproveExpenseHandler } from './application/handlers/approve-expense.handler';
import { RejectExpenseHandler } from './application/handlers/reject-expense.handler';
import { CancelExpenseHandler } from './application/handlers/cancel-expense.handler';
import { CreateAdjustmentHandler } from './application/handlers/create-adjustment.handler';
import { ExpenseController } from './presentation/controllers/expense.controller';
import { ExpenseScopeProvider } from './infrastructure/auth/expense-scope.provider';

@Module({
  // FinancialPeriodModule imported to get PERIOD_STATUS_PORT (Phase 3.2's
  // Open-Host Service) — this is the first real cross-context dependency
  // in the codebase, and it's a clean one-directional import, not a
  // circular one, exactly per the context map from Phase 3.5.
  imports: [FinancialPeriodModule],
  controllers: [ExpenseController],
  providers: [
    { provide: EXPENSE_REPOSITORY, useClass: PrismaExpenseRepository },
    { provide: APPROVAL_POLICY, useClass: ExpenseApprovalPolicy },
    { provide: ADJUSTMENT_APPROVAL_POLICY, useClass: ExpenseAdjustmentApprovalPolicy },
    { provide: APPROVAL_PROGRESS_REPOSITORY, useClass: PrismaApprovalProgressRepository },
    CreateExpenseHandler,
    SubmitExpenseHandler,
    ApproveExpenseHandler,
    RejectExpenseHandler,
    CancelExpenseHandler,
    CreateAdjustmentHandler,
    ExpenseScopeProvider,
  ],
  exports: [
    CreateExpenseHandler,
    SubmitExpenseHandler,
    ApproveExpenseHandler,
    RejectExpenseHandler,
    CancelExpenseHandler,
    CreateAdjustmentHandler,
  ],
})
export class ExpenseModule {}
