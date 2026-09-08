// src/reporting/reporting.module.ts
import { Module } from '@nestjs/common';
import { ExpenseReadModelProjector } from './infrastructure/projectors/expense-read-model.projector';
import { DepartmentSpendingSummaryHandler } from './application/handlers/department-spending-summary.handler';
import { TopCategoriesHandler } from './application/handlers/top-categories.handler';
import { TopVendorsHandler } from './application/handlers/top-vendors.handler';
import { ReportsController } from './presentation/controllers/reports.controller';
import { CashOutflowHandler } from './application/handlers/cash-outflow.handler';
import { ProjectSpendingHandler } from './application/handlers/project-spending.handler';
import { PayrollSummaryHandler } from './application/handlers/payroll-summary.handler';
import { PendingDepartmentSpendingHandler } from './application/handlers/pending-department-spending.handler';
import { ExpenseStatusBreakdownHandler } from './application/handlers/expense-status-breakdown.handler';
import { ExpenseAdjustmentsSummaryHandler } from './application/handlers/expense-adjustments-summary.handler';
import { RequesterSpendingHandler } from './application/handlers/requester-spending.handler';

@Module({
  controllers: [ReportsController],
  providers: [
    ExpenseReadModelProjector,
    DepartmentSpendingSummaryHandler,
    TopCategoriesHandler,
    TopVendorsHandler,
    CashOutflowHandler,
    ProjectSpendingHandler,
    PayrollSummaryHandler,
    PendingDepartmentSpendingHandler,
    ExpenseStatusBreakdownHandler,
    ExpenseAdjustmentsSummaryHandler,
    RequesterSpendingHandler,
  ],
})
export class ReportingModule {}
