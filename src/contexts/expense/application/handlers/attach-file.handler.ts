// src/contexts/expense/application/handlers/attach-file.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { PrismaService } from '../../../../prisma/prisma.service';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../../../../storage/object-storage.port';
import { DomainError, EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import { EXPENSE_REPOSITORY, ExpenseRepository } from '../../domain/ports/expense-repository.port';
import { AttachFileCommand } from '../commands/attach-file.command';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export class UnsupportedFileTypeError extends DomainError {
  readonly code = 'unsupported-file-type';
  readonly httpStatus = 400;

  constructor(contentType: string) {
    super(
      `File type "${contentType}" is not supported — allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
    );
  }
}

export class FileTooLargeError extends DomainError {
  readonly code = 'file-too-large';
  readonly httpStatus = 400;

  constructor(sizeBytes: number) {
    super(`File size ${sizeBytes} bytes exceeds the ${MAX_FILE_SIZE_BYTES} byte limit`);
  }
}

@Injectable()
export class AttachFileHandler implements CommandHandler<
  AttachFileCommand,
  { attachmentId: string }
> {
  constructor(
    @Inject(EXPENSE_REPOSITORY) private readonly expenseRepo: ExpenseRepository,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: AttachFileCommand): Promise<{ attachmentId: string }> {
    if (!ALLOWED_CONTENT_TYPES.includes(cmd.contentType))
      throw new UnsupportedFileTypeError(cmd.contentType);
    if (cmd.buffer.length > MAX_FILE_SIZE_BYTES) throw new FileTooLargeError(cmd.buffer.length);

    const expense = await this.expenseRepo.findById(cmd.expenseId);
    if (!expense || expense.organizationId !== cmd.organizationId) {
      throw new EntityNotFoundError('Expense', cmd.expenseId);
    }

    const attachmentId = randomUUID();
    const storageKey = `${cmd.organizationId}/expenses/${cmd.expenseId}/${attachmentId}-${cmd.fileName}`;

    // Upload to storage FIRST, only persist metadata if that succeeds —
    // avoids a DB row pointing at a file that was never actually stored.
    await this.storage.upload(storageKey, cmd.buffer, cmd.contentType);

    await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        expenseId: cmd.expenseId,
        organizationId: cmd.organizationId,
        storageKey,
        fileName: cmd.fileName,
        contentType: cmd.contentType,
        sizeBytes: cmd.buffer.length,
        uploadedById: cmd.uploadedById,
        scanStatus: 'unscanned', // honest default — no real scanner wired up (TECH_DEBT)
      },
    });

    return { attachmentId };
  }
}
