// src/contexts/expense/presentation/controllers/expense.controller.ts
// (replace entire file)
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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
import { humanSource } from '../../domain/value-objects/expense-source';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';

@Controller({ path: 'expenses', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ExpenseController {
  constructor(
    private readonly createExpense: CreateExpenseHandler,
    private readonly submitExpense: SubmitExpenseHandler,
    private readonly approveExpense: ApproveExpenseHandler,
    private readonly rejectExpense: RejectExpenseHandler,
    private readonly cancelExpense: CancelExpenseHandler,
    private readonly createAdjustment: CreateAdjustmentHandler,
  ) {}

  @RequirePermission('expense:create', { scope: 'own' })
  @Post()
  async create(
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string; expenseNumber: string }> {
    return this.createExpense.execute(
      new CreateExpenseCommand(
        user.organizationId,
        humanSource(dto.sourceType, user.id),
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

  @RequirePermission('expense:create', { scope: 'own' })
  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.submitExpense.execute(new SubmitExpenseCommand(id, user.organizationId));
  }

  @RequirePermission('expense:approve', { scope: 'department' })
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.approveExpense.execute(new ApproveExpenseCommand(id, user.organizationId, user.id));
  }

  @RequirePermission('expense:approve', { scope: 'department' })
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectExpenseDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<void> {
    await this.rejectExpense.execute(
      new RejectExpenseCommand(id, user.organizationId, user.id, dto.reason),
    );
  }

  @RequirePermission('expense:create', { scope: 'own' })
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.cancelExpense.execute(new CancelExpenseCommand(id, user.organizationId, user.id));
  }

  @RequirePermission('expense:adjust', { scope: 'department' })
  @Post(':id/adjustments')
  async adjust(
    @Param('id') id: string,
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string }> {
    // Finally resolved — organizationId comes from the authenticated user,
    // never the client, closing the gap flagged back when this endpoint
    // was first built (piece 5 of M2).
    return this.createAdjustment.execute(
      new CreateAdjustmentCommand(id, user.organizationId, dto.reason),
    );
  }
}
