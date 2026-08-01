// src/contexts/payroll/presentation/controllers/payroll-run.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
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
import { OrganizationScopeDto } from '../dto/organization-scope.dto';
import { RejectPayrollRunDto } from '../dto/reject-payroll-run.dto';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';

const DEFAULT_CURRENCY = 'NGN';

/**
 * Same placeholder-actor-id pattern as ExpenseController and
 * FinancialPeriodController — every @CurrentUser() gap here is deliberate
 * and temporary, resolved together once the auth module lands.
 */
@Controller({ path: 'payroll-runs', version: '1' })
export class PayrollRunController {
  constructor(
    private readonly createPayrollRun: CreatePayrollRunHandler,
    private readonly addPayslip: AddPayslipHandler,
    private readonly submitPayrollRun: SubmitPayrollRunHandler,
    private readonly approvePayrollRun: ApprovePayrollRunHandler,
    private readonly rejectPayrollRun: RejectPayrollRunHandler,
    private readonly processPayrollRun: ProcessPayrollRunHandler,
    private readonly cancelPayrollRun: CancelPayrollRunHandler,
  ) {}

  // @RequirePermission('payroll:create', { scope: 'organization' })
  @Post()
  async create(@Body() dto: CreatePayrollRunDto): Promise<{ id: string }> {
    const createdById = 'PLACEHOLDER_PAYROLL_ADMIN_ID';
    return this.createPayrollRun.execute(
      new CreatePayrollRunCommand(dto.organizationId, new Date(dto.runMonth), createdById),
    );
  }

  // @RequirePermission('payroll:create', { scope: 'organization' })
  @Post(':id/payslips')
  async addPayslipToRun(
    @Param('id') id: string,
    @Body() dto: AddPayslipDto,
  ): Promise<{ payslipId: string }> {
    const additionalLineItems: SalaryLineItem[] = (dto.additionalLineItems ?? []).map((item) => ({
      kind: item.kind,
      label: item.label,
      amount: Money.of(BigInt(item.amountMinorUnits), DEFAULT_CURRENCY as any),
    }));

    return this.addPayslip.execute(
      new AddPayslipCommand(id, dto.organizationId, dto.employeeId, additionalLineItems),
    );
  }

  // @RequirePermission('payroll:create', { scope: 'organization' })
  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    await this.submitPayrollRun.execute(new SubmitPayrollRunCommand(id, dto.organizationId));
  }

  // @RequirePermission('payroll:approve', { scope: 'organization' })
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    const approverId = 'PLACEHOLDER_FINANCE_DIRECTOR_ID';
    await this.approvePayrollRun.execute(
      new ApprovePayrollRunCommand(id, dto.organizationId, approverId),
    );
  }

  // @RequirePermission('payroll:approve', { scope: 'organization' })
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectPayrollRunDto): Promise<void> {
    const approverId = 'PLACEHOLDER_FINANCE_DIRECTOR_ID';
    await this.rejectPayrollRun.execute(
      new RejectPayrollRunCommand(id, dto.organizationId, approverId, dto.reason),
    );
  }

  // @RequirePermission('payroll:create', { scope: 'organization' })
  @Post(':id/process')
  async process(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    await this.processPayrollRun.execute(new ProcessPayrollRunCommand(id, dto.organizationId));
  }

  // @RequirePermission('payroll:create', { scope: 'organization' })
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    const actorId = 'PLACEHOLDER_PAYROLL_ADMIN_ID';
    await this.cancelPayrollRun.execute(
      new CancelPayrollRunCommand(id, dto.organizationId, actorId),
    );
  }
}
