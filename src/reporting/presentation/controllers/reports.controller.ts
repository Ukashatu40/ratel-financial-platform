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
}
