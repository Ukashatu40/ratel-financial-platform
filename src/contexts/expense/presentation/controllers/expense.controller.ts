// src/contexts/expense/presentation/controllers/expense.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreateExpenseHandler } from '../../application/handlers/create-expense.handler';
import { SubmitExpenseHandler } from '../../application/handlers/submit-expense.handler';
import { ApproveExpenseHandler } from '../../application/handlers/approve-expense.handler';
import { RejectExpenseHandler } from '../../application/handlers/reject-expense.handler';
import { CancelExpenseHandler } from '../../application/handlers/cancel-expense.handler';
import { CreateAdjustmentHandler } from '../../application/handlers/create-adjustment.handler';
import { CreateExpenseCommand } from '../../application/commands/create-expense.command';
import { SubmitExpenseCommand } from '../../application/commands/submit-expense.command';
import { ApproveExpenseCommand } from '../../application/commands/approve-expense.command';
import { RejectExpenseCommand } from '../../application/commands/reject-expense.command';
import { CancelExpenseCommand } from '../../application/commands/cancel-expense.command';
import { CreateAdjustmentCommand } from '../../application/commands/create-adjustment.command';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { RejectExpenseDto } from '../dto/reject-expense.dto';
import { CreateAdjustmentDto } from '../dto/create-adjustment.dto';
import { OrganizationScopeDto } from '../dto/organization-scope.dto';
import { humanSource } from '../../domain/value-objects/expense-source';

/**
 * NOTE: every endpoint below has a commented-out @RequirePermission line and
 * a hardcoded placeholder actor id, matching the same visible, temporary gap
 * left in FinancialPeriodController — both get resolved together once the
 * auth module lands and @CurrentUser() exists. Leaving these obvious rather
 * than silently omitted so nothing here is mistaken for "authorization
 * already handled."
 */
@Controller({ path: 'expenses', version: '1' })
export class ExpenseController {
  constructor(
    private readonly createExpense: CreateExpenseHandler,
    private readonly submitExpense: SubmitExpenseHandler,
    private readonly approveExpense: ApproveExpenseHandler,
    private readonly rejectExpense: RejectExpenseHandler,
    private readonly cancelExpense: CancelExpenseHandler,
    private readonly createAdjustment: CreateAdjustmentHandler,
  ) {}

  // @RequirePermission('expense:create', { scope: 'own' })
  @Post()
  async create(@Body() dto: CreateExpenseDto): Promise<{ id: string; expenseNumber: string }> {
    const actorId = 'PLACEHOLDER_USER_ID'; // -> @CurrentUser().id once auth lands

    return this.createExpense.execute(
      new CreateExpenseCommand(
        dto.organizationId,
        humanSource(dto.sourceType, actorId),
        BigInt(dto.amountMinorUnits),
        dto.currency,
        dto.categoryId,
        dto.departmentId,
        new Date(dto.expenseDate),
        dto.vendorId,
        dto.projectId,
        dto.description,
      ),
    );
  }

  // @RequirePermission('expense:create', { scope: 'own' })  // submit is self-service, same permission as create
  @Post(':id/submit')
  async submit(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    await this.submitExpense.execute(new SubmitExpenseCommand(id, dto.organizationId));
  }

  // @RequirePermission('expense:approve', { scope: 'department' })
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    const approverId = 'PLACEHOLDER_APPROVER_ID'; // -> @CurrentUser().id once auth lands
    await this.approveExpense.execute(new ApproveExpenseCommand(id, dto.organizationId, approverId));
  }

  // @RequirePermission('expense:approve', { scope: 'department' })
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectExpenseDto): Promise<void> {
    const approverId = 'PLACEHOLDER_APPROVER_ID';
    await this.rejectExpense.execute(new RejectExpenseCommand(id, dto.organizationId, approverId, dto.reason));
  }

  // @RequirePermission('expense:create', { scope: 'own' })  // cancel is self-service on your own draft/pending expense
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() dto: OrganizationScopeDto): Promise<void> {
    const actorId = 'PLACEHOLDER_USER_ID';
    await this.cancelExpense.execute(new CancelExpenseCommand(id, dto.organizationId, actorId));
  }

  // @RequirePermission('expense:adjust', { scope: 'department' })
  @Post(':id/adjustments')
  async adjust(@Param('id') id: string, @Body() dto: CreateAdjustmentDto): Promise<{ id: string }> {
    // organizationId intentionally NOT accepted on this endpoint — resolved
    // server-side from the original expense being adjusted, since an
    // adjustment can only ever target the org that owns the original.
    // The handler already re-validates original.organizationId internally.
    throw new Error('organizationId resolution pending @CurrentUser() wiring'); // placeholder — see note below
  }
}