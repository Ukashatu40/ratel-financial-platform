// src/contexts/financial-period/presentation/controllers/financial-period.controller.ts
import { Controller, Get, Param, Post, Query, UseGuards, Body } from '@nestjs/common';
import { OpenPeriodHandler } from '../../application/handlers/open-period.handler';
import { ClosePeriodHandler } from '../../application/handlers/close-period.handler';
import { ReopenPeriodHandler } from '../../application/handlers/reopen-period.handler';
import { ListPeriodsHandler } from '../../application/handlers/list-periods.handler';
import { GetPeriodByIdHandler } from '../../application/handlers/get-period-by-id.handler';
import { GetCurrentOpenPeriodHandler } from '../../application/handlers/get-current-open-period.handler';
import { OpenPeriodCommand } from '../../application/commands/open-period.command';
import { ClosePeriodCommand } from '../../application/commands/close-period.command';
import { ReopenPeriodCommand } from '../../application/commands/reopen-period.command';
import { GetCurrentOpenPeriodQuery } from '../../application/queries/get-current-open-period.query';
import { ListPeriodsQuery } from '../../application/queries/list-periods.query';
import { GetPeriodByIdQuery } from '../../application/queries/get-period-by-id.query';
import { OpenPeriodDto } from '../dto/open-period.dto';
import { ReopenPeriodDto } from '../dto/reopen-period.dto';
import { ListPeriodsDto } from '../dto/list-periods.dto';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('Financial Periods')
@ApiBearerAuth('access-token')
@Controller({ path: 'financial-periods', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FinancialPeriodController {
  constructor(
    private readonly openPeriod: OpenPeriodHandler,
    private readonly closePeriod: ClosePeriodHandler,
    private readonly reopenPeriod: ReopenPeriodHandler,
    private readonly listPeriods: ListPeriodsHandler,
    private readonly getPeriodById: GetPeriodByIdHandler,
    private readonly getCurrentOpenPeriod: GetCurrentOpenPeriodHandler,
  ) {}

  @RequirePermission('period:open')
  @Post()
  async open(
    @Body() dto: OpenPeriodDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string }> {
    return this.openPeriod.execute(
      new OpenPeriodCommand(user.organizationId, new Date(dto.startDate), new Date(dto.endDate)),
    );
  }

  @RequirePermission('period:close')
  @Post(':id/close')
  async close(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.closePeriod.execute(new ClosePeriodCommand(user.organizationId, id, user.id));
  }

  @ApiOperation({
    summary: 'Reopen a closed financial period',
    description:
      'Closing a period makes every Expense and Payroll mutation throw PeriodClosedError, ' +
      'so a record left mid-approval at close time can be neither approved nor rejected. ' +
      'This is the route back. Gated on the existing period:open permission — reopening is ' +
      'the same authority as opening, so no new permission was introduced. The required ' +
      'reason is recorded in the audit log.',
  })
  @RequirePermission('period:open')
  @Post(':id/reopen')
  async reopen(
    @Param('id') id: string,
    @Body() dto: ReopenPeriodDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<void> {
    await this.reopenPeriod.execute(
      new ReopenPeriodCommand(user.organizationId, id, user.id, dto.reason),
    );
  }

  @ApiOperation({
    summary: 'List financial periods for the caller organization, newest first',
    description:
      'Includes closed periods, unlike GET /current which matches open statuses only — ' +
      'this is how a closed period id is discovered in order to reopen it.',
  })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closing', 'closed', 'reopened'] })
  @RequirePermission('period:open')
  @Get()
  async list(@Query() dto: ListPeriodsDto, @CurrentUser() user: UserPrincipal) {
    return this.listPeriods.execute(new ListPeriodsQuery(user.organizationId, dto.status));
  }

  // No @RequirePermission — any authenticated user can check the current
  // open period; it's read-only and not sensitive, unlike open/close.
  @Get('current')
  async current(@CurrentUser() user: UserPrincipal) {
    return this.getCurrentOpenPeriod.execute(new GetCurrentOpenPeriodQuery(user.organizationId));
  }

  // Declared AFTER 'current' deliberately: route matching is order-sensitive, so
  // a ':id' registered first would swallow /current and treat it as a period id.
  @ApiOperation({ summary: 'Get one financial period by id' })
  @RequirePermission('period:open')
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getPeriodById.execute(new GetPeriodByIdQuery(id, user.organizationId));
  }
}
