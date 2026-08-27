// src/contexts/payroll/presentation/controllers/payroll-run.controller.ts
import { Body, Controller, Param, Post, UseGuards, Get, Query } from '@nestjs/common';
import { CreatePayrollRunHandler } from '../../application/handlers/create-payroll-run.handler';
import { AddPayslipHandler } from '../../application/handlers/add-payslip.handler';
import { SubmitPayrollRunHandler } from '../../application/handlers/submit-payroll-run.handler';
import { ApprovePayrollRunHandler } from '../../application/handlers/approve-payroll-run.handler';
import { RejectPayrollRunHandler } from '../../application/handlers/reject-payroll-run.handler';
import { ProcessPayrollRunHandler } from '../../application/handlers/process-payroll-run.handler';
import { CancelPayrollRunHandler } from '../../application/handlers/cancel-payroll-run.handler';
import { CreatePayrollRunCommand } from '../../application/commands/create-payroll-run.command';
import { AddPayslipCommand } from '../../application/commands/add-payslip.command';
import { SubmitPayrollRunCommand } from '../../application/commands/submit-payroll-run.command';
import { ApprovePayrollRunCommand } from '../../application/commands/approve-payroll-run.command';
import { RejectPayrollRunCommand } from '../../application/commands/reject-payroll-run.command';
import { ProcessPayrollRunCommand } from '../../application/commands/process-payroll-run.command';
import { CancelPayrollRunCommand } from '../../application/commands/cancel-payroll-run.command';
import { CreatePayrollRunDto } from '../dto/create-payroll-run.dto';
import { AddPayslipDto } from '../dto/add-payslip.dto';
import { RejectPayrollRunDto } from '../dto/reject-payroll-run.dto';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import { GetPayrollRunByIdHandler } from '../../application/handlers/get-payroll-run-by-id.handler';
import { ListPayrollRunsHandler } from '../../application/handlers/list-payroll-runs.handler';
import { GetPayrollRunByIdQuery } from '../../application/queries/get-payroll-run-by-id.query';
import { ListPayrollRunsQuery } from '../../application/queries/list-payroll-runs.query';
import { ListPayrollRunsDto } from '../dto/list-payroll-runs.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

const DEFAULT_CURRENCY = 'NGN';

@ApiTags('Payroll')
@ApiBearerAuth('access-token')
@Controller({ path: 'payroll-runs', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PayrollRunController {
  constructor(
    private readonly createPayrollRun: CreatePayrollRunHandler,
    private readonly addPayslip: AddPayslipHandler,
    private readonly submitPayrollRun: SubmitPayrollRunHandler,
    private readonly approvePayrollRun: ApprovePayrollRunHandler,
    private readonly rejectPayrollRun: RejectPayrollRunHandler,
    private readonly processPayrollRun: ProcessPayrollRunHandler,
    private readonly cancelPayrollRun: CancelPayrollRunHandler,
    private readonly getPayrollRunById: GetPayrollRunByIdHandler,
    private readonly listPayrollRuns: ListPayrollRunsHandler,
  ) {}

  @ApiOperation({ summary: 'Create a new payroll run for the specified month' })
  @RequirePermission('payroll:create')
  @Post()
  async create(
    @Body() dto: CreatePayrollRunDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string }> {
    return this.createPayrollRun.execute(
      new CreatePayrollRunCommand(user.organizationId, new Date(dto.runMonth), user.id),
    );
  }

  @ApiOperation({ summary: 'Get a single payroll run by ID' })
  @RequirePermission('payroll:view_sensitive')
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getPayrollRunById.execute(new GetPayrollRunByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List payroll runs for the organization, with optional pagination' })
  @RequirePermission('payroll:view_sensitive')
  @Get()
  async list(@Query() dto: ListPayrollRunsDto, @CurrentUser() user: UserPrincipal) {
    return this.listPayrollRuns.execute(
      new ListPayrollRunsQuery(user.organizationId, dto.cursor, dto.limit),
    );
  }

  @ApiOperation({ summary: 'Add a payslip to an existing payroll run' })
  @RequirePermission('payroll:create')
  @Post(':id/payslips')
  async addPayslipToRun(
    @Param('id') id: string,
    @Body() dto: AddPayslipDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ payslipId: string }> {
    const additionalLineItems: SalaryLineItem[] = (dto.additionalLineItems ?? []).map((item) => ({
      kind: item.kind,
      label: item.label,
      amount: Money.of(BigInt(item.amountMinorUnits), DEFAULT_CURRENCY),
    }));

    return this.addPayslip.execute(
      new AddPayslipCommand(id, user.organizationId, dto.employeeId, additionalLineItems),
    );
  }

  @ApiOperation({ summary: 'Submit a payroll run for approval' })
  @RequirePermission('payroll:create')
  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.submitPayrollRun.execute(new SubmitPayrollRunCommand(id, user.organizationId));
  }

  @ApiOperation({ summary: 'Approve a submitted payroll run' })
  @RequirePermission('payroll:approve')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.approvePayrollRun.execute(
      new ApprovePayrollRunCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Reject a submitted payroll run with a reason' })
  @RequirePermission('payroll:approve')
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectPayrollRunDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<void> {
    await this.rejectPayrollRun.execute(
      new RejectPayrollRunCommand(id, user.organizationId, user.id, dto.reason),
    );
  }

  @ApiOperation({ summary: 'Process an approved payroll run (finalize and generate payslips)' })
  @RequirePermission('payroll:create')
  @Post(':id/process')
  async process(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.processPayrollRun.execute(new ProcessPayrollRunCommand(id, user.organizationId));
  }

  @ApiOperation({ summary: 'Cancel a payroll run (draft or submitted)' })
  @RequirePermission('payroll:create')
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.cancelPayrollRun.execute(
      new CancelPayrollRunCommand(id, user.organizationId, user.id),
    );
  }
}
