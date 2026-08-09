// src/contexts/expense/presentation/controllers/expense.controller.ts
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  Get,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
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
import { GetExpenseByIdHandler } from '../../application/handlers/get-expense-by-id.handler';
import { ListExpensesHandler } from '../../application/handlers/list-expenses.handler';
import { GetExpenseByIdQuery } from '../../application/queries/get-expense-by-id.query';
import { ListExpensesQuery } from '../../application/queries/list-expenses.query';
import { ListExpensesDto } from '../dto/list-expenses.dto';
import { AttachFileHandler } from '../../application/handlers/attach-file.handler';
import { GetAttachmentDownloadUrlHandler } from '../../application/handlers/get-attachment-download-url.handler';
import { ListAttachmentsHandler } from '../../application/handlers/list-attachments.handler';
import { AttachFileCommand } from '../../application/commands/attach-file.command';
import { GetAttachmentDownloadUrlQuery } from '../../application/queries/get-attachment-download-url.query';
import { ListAttachmentsQuery } from '../../application/queries/list-attachments.query';
import { FastifyRequest } from 'fastify';

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
    private readonly getExpenseById: GetExpenseByIdHandler,
    private readonly listExpenses: ListExpensesHandler,
    private readonly attachFile: AttachFileHandler,
    private readonly getAttachmentDownloadUrl: GetAttachmentDownloadUrlHandler,
    private readonly listAttachments: ListAttachmentsHandler,
  ) {}

  @RequirePermission('expense:create') // was: { scope: 'own' } — create has no resource yet
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

  @RequirePermission('expense:view', { resourceType: 'expense' })
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getExpenseById.execute(new GetExpenseByIdQuery(id, user.organizationId));
  }

  @RequirePermission('expense:view')
  @Get()
  async list(@Query() dto: ListExpensesDto, @CurrentUser() user: UserPrincipal) {
    return this.listExpenses.execute(
      new ListExpensesQuery(user, dto.status, dto.cursor, dto.limit),
    );
  }

  @RequirePermission('expense:create', { resourceType: 'expense' }) // now checks: is this YOUR draft, if you're 'own'-scoped
  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.submitExpense.execute(new SubmitExpenseCommand(id, user.organizationId));
  }

  @RequirePermission('expense:approve', { resourceType: 'expense' }) // now checks: is this YOUR department, if you're 'department'-scoped
  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.approveExpense.execute(new ApproveExpenseCommand(id, user.organizationId, user.id));
  }

  @RequirePermission('expense:approve', { resourceType: 'expense' })
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

  @RequirePermission('expense:create', { resourceType: 'expense' })
  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: UserPrincipal): Promise<void> {
    await this.cancelExpense.execute(new CancelExpenseCommand(id, user.organizationId, user.id));
  }

  @RequirePermission('expense:adjust', { resourceType: 'expense' })
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

  // Reuses 'expense:create' + resourceType: 'expense' — same permission
  // gate as submit/cancel, since attaching a receipt is naturally part of
  // the same "own this draft" capability, not a separate grant.
  @RequirePermission('expense:create', { resourceType: 'expense' })
  @Post(':id/attachments')
  async attach(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: UserPrincipal,
  ) {
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!file) throw new BadRequestException('No file uploaded'); // was: throw new Error(...) -> 500

    const buffer = await file.toBuffer();
    return this.attachFile.execute(
      new AttachFileCommand(id, user.organizationId, user.id, file.filename, file.mimetype, buffer),
    );
  }

  @RequirePermission('expense:view', { resourceType: 'expense' })
  @Get(':id/attachments')
  async listAttachmentsForExpense(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.listAttachments.execute(new ListAttachmentsQuery(id, user.organizationId));
  }

  @RequirePermission('expense:view', { resourceType: 'expense' })
  @Get(':id/attachments/:attachmentId/download-url')
  async getAttachmentUrl(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: UserPrincipal,
  ) {
    return this.getAttachmentDownloadUrl.execute(
      new GetAttachmentDownloadUrlQuery(id, attachmentId, user.organizationId),
    );
  }
}
