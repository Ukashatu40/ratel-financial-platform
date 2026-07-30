// src/contexts/financial-period/presentation/controllers/financial-period.controller.ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { OpenPeriodHandler } from '../../application/handlers/open-period.handler';
import { ClosePeriodHandler } from '../../application/handlers/close-period.handler';
import { GetCurrentOpenPeriodHandler } from '../../application/handlers/get-current-open-period.handler';
import { OpenPeriodCommand } from '../../application/commands/open-period.command';
import { ClosePeriodCommand } from '../../application/commands/close-period.command';
import { GetCurrentOpenPeriodQuery } from '../../application/queries/get-current-open-period.query';
import { OpenPeriodDto } from '../dto/open-period.dto';
import { ClosePeriodDto } from '../dto/close-period.dto';
// import { CurrentUser } from '../../../../auth/authentication/current-user.decorator'; // wired in the auth module (later)
// import { RequirePermission } from '../../../../auth/authorization/permission.decorator';

@Controller({ path: 'financial-periods', version: '1' })
export class FinancialPeriodController {
  constructor(
    private readonly openPeriod: OpenPeriodHandler,
    private readonly closePeriod: ClosePeriodHandler,
    private readonly getCurrentOpenPeriod: GetCurrentOpenPeriodHandler,
  ) {}

  // @RequirePermission('period:open', { scope: 'organization' })  // wired once auth module lands
  @Post()
  async open(@Body() dto: OpenPeriodDto): Promise<{ id: string }> {
    return this.openPeriod.execute(
      new OpenPeriodCommand(dto.organizationId, new Date(dto.startDate), new Date(dto.endDate)),
    );
  }

  // @RequirePermission('period:close', { scope: 'organization' })
  @Post(':id/close')
  async close(@Param('id') id: string, @Body() dto: ClosePeriodDto /*, @CurrentUser() user */): Promise<void> {
    // closedById will come from @CurrentUser() once auth is wired — placeholder param for now
    await this.closePeriod.execute(new ClosePeriodCommand(dto.organizationId, id, 'PLACEHOLDER_USER_ID'));
  }

  @Get('current')
  async current(@Query('organizationId') organizationId: string) {
    return this.getCurrentOpenPeriod.execute(new GetCurrentOpenPeriodQuery(organizationId));
  }
}