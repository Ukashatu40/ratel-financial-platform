// src/reporting/presentation/controllers/reports.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DepartmentSpendingSummaryHandler } from '../../application/handlers/department-spending-summary.handler';
import { TopCategoriesHandler } from '../../application/handlers/top-categories.handler';
import { TopVendorsHandler } from '../../application/handlers/top-vendors.handler';
import { DepartmentSpendingSummaryQuery } from '../../application/queries/department-spending-summary.query';
import { TopCategoriesQuery } from '../../application/queries/top-categories.query';
import { TopVendorsQuery } from '../../application/queries/top-vendors.query';
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
}
