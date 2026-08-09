// src/contexts/financial-period/presentation/controllers/financial-period.controller.ts
import { Controller, Get, Param, Post, Query, UseGuards, Body } from '@nestjs/common';
import { OpenPeriodHandler } from '../../application/handlers/open-period.handler';
import { ClosePeriodHandler } from '../../application/handlers/close-period.handler';
import { GetCurrentOpenPeriodHandler } from '../../application/handlers/get-current-open-period.handler';
import { OpenPeriodCommand } from '../../application/commands/open-period.command';
import { ClosePeriodCommand } from '../../application/commands/close-period.command';
import { GetCurrentOpenPeriodQuery } from '../../application/queries/get-current-open-period.query';
import { OpenPeriodDto } from '../dto/open-period.dto';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Financial Periods')
@ApiBearerAuth('access-token')
@Controller({ path: 'financial-periods', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FinancialPeriodController {
  constructor(
    private readonly openPeriod: OpenPeriodHandler,
    private readonly closePeriod: ClosePeriodHandler,
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

  // No @RequirePermission — any authenticated user can check the current
  // open period; it's read-only and not sensitive, unlike open/close.
  @Get('current')
  async current(@CurrentUser() user: UserPrincipal) {
    return this.getCurrentOpenPeriod.execute(new GetCurrentOpenPeriodQuery(user.organizationId));
  }
}
