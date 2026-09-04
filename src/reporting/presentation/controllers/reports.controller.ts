// src/reporting/presentation/controllers/reports.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DepartmentSpendingSummaryHandler } from '../../application/handlers/department-spending-summary.handler';
import { TopCategoriesHandler } from '../../application/handlers/top-categories.handler';
import { TopVendorsHandler } from '../../application/handlers/top-vendors.handler';
import { DepartmentSpendingSummaryQuery } from '../../application/queries/department-spending-summary.query';
import { TopCategoriesQuery } from '../../application/queries/top-categories.query';
import { TopVendorsQuery } from '../../application/queries/top-vendors.query';
import { CashOutflowHandler } from '../../application/handlers/cash-outflow.handler';
import { ProjectSpendingHandler } from '../../application/handlers/project-spending.handler';
import { PayrollSummaryHandler } from '../../application/handlers/payroll-summary.handler';
import { CashOutflowQuery } from '../../application/queries/cash-outflow.query';
import { ProjectSpendingQuery } from '../../application/queries/project-spending.query';
import { PayrollSummaryQuery } from '../../application/queries/payroll-summary.query';
import { DateRangeDto } from '../dto/date-range.dto';
import { PendingDepartmentSpendingHandler } from '../../application/handlers/pending-department-spending.handler';
import { PendingDepartmentSpendingQuery } from '../../application/queries/pending-department-spending.query';
import { ExpenseStatusBreakdownHandler } from '../../application/handlers/expense-status-breakdown.handler';
import { ExpenseStatusBreakdownQuery } from '../../application/queries/expense-status-breakdown.query';
import { ExpenseAdjustmentsSummaryHandler } from '../../application/handlers/expense-adjustments-summary.handler';
import { ExpenseAdjustmentsSummaryQuery } from '../../application/queries/expense-adjustments-summary.query';
import { RequesterSpendingHandler } from '../../application/handlers/requester-spending.handler';
import { RequesterSpendingQuery } from '../../application/queries/requester-spending.query';
import { TopNDto } from '../dto/top-n.dto';
import { JwtAuthGuard } from '../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller({ path: 'reports', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReportsController {
  constructor(
    private readonly departmentSpendingSummary: DepartmentSpendingSummaryHandler,
    private readonly topCategories: TopCategoriesHandler,
    private readonly topVendors: TopVendorsHandler,
    private readonly cashOutflow: CashOutflowHandler,
    private readonly projectSpending: ProjectSpendingHandler,
    private readonly payrollSummary: PayrollSummaryHandler,
    private readonly pendingDepartmentSpending: PendingDepartmentSpendingHandler,
    private readonly expenseStatusBreakdown: ExpenseStatusBreakdownHandler,
    private readonly expenseAdjustmentsSummary: ExpenseAdjustmentsSummaryHandler,
    private readonly requesterSpending: RequesterSpendingHandler,
  ) {}

  @ApiOperation({ summary: 'Total approved spending grouped by department, within a date range' })
  @RequirePermission('report:view')
  @Get('department-spending')
  async getDepartmentSpending(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.departmentSpendingSummary.execute(
      new DepartmentSpendingSummaryQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({ summary: 'Top N spending categories by total approved amount' })
  @RequirePermission('report:view')
  @Get('top-categories')
  async getTopCategories(@Query() dto: TopNDto, @CurrentUser() user: UserPrincipal) {
    return this.topCategories.execute(
      new TopCategoriesQuery(user, new Date(dto.from), new Date(dto.to), dto.limit ?? 10),
    );
  }

  @ApiOperation({ summary: 'Top N vendors by total approved spending' })
  @RequirePermission('report:view')
  @Get('top-vendors')
  async getTopVendors(@Query() dto: TopNDto, @CurrentUser() user: UserPrincipal) {
    return this.topVendors.execute(
      new TopVendorsQuery(user, new Date(dto.from), new Date(dto.to), dto.limit ?? 10),
    );
  }

  @ApiOperation({ summary: 'Total approved cash outflow, bucketed by month' })
  @RequirePermission('report:view')
  @Get('cash-outflow')
  async getCashOutflow(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.cashOutflow.execute(
      new CashOutflowQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({ summary: 'Total approved spending grouped by project' })
  @RequirePermission('report:view')
  @Get('project-spending')
  async getProjectSpending(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.projectSpending.execute(
      new ProjectSpendingQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({ summary: 'Payroll gross/net totals by run month' })
  @RequirePermission('payroll:view_sensitive') // NOT report:view — payroll stays behind its existing, stricter permission
  @Get('payroll-summary')
  async getPayrollSummary(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.payrollSummary.execute(
      new PayrollSummaryQuery(user.organizationId, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({
    summary:
      'Outstanding spend awaiting approval, grouped by department — not yet approved, so not counted as spent elsewhere',
  })
  @RequirePermission('report:view')
  @Get('pending-department-spending')
  async getPendingDepartmentSpending(
    @Query() dto: DateRangeDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    return this.pendingDepartmentSpending.execute(
      new PendingDepartmentSpendingQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({
    summary:
      'Full expense funnel by status (draft through closed) within a date range — not just approved spend',
  })
  @RequirePermission('report:view')
  @Get('expense-status-breakdown')
  async getExpenseStatusBreakdown(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.expenseStatusBreakdown.execute(
      new ExpenseStatusBreakdownQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({
    summary:
      'Approved expense adjustments (corrections/reversals) by department — net signed total plus a count, since offsetting adjustments net to zero',
  })
  @RequirePermission('report:view')
  @Get('expense-adjustments-summary')
  async getExpenseAdjustmentsSummary(
    @Query() dto: DateRangeDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    return this.expenseAdjustmentsSummary.execute(
      new ExpenseAdjustmentsSummaryQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }

  @ApiOperation({
    summary:
      'Total approved spending grouped by requester, resolved to name (or email if unlinked)',
  })
  @RequirePermission('report:view')
  @Get('requester-spending')
  async getRequesterSpending(@Query() dto: DateRangeDto, @CurrentUser() user: UserPrincipal) {
    return this.requesterSpending.execute(
      new RequesterSpendingQuery(user, new Date(dto.from), new Date(dto.to)),
    );
  }
}
