// src/contexts/expense/application/handlers/get-attachment-download-url.handler.ts
import { Inject, Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../../prisma/prisma.service';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../../../../storage/object-storage.port';
import {
  AttachmentNotSafeToDownloadError,
  EntityNotFoundError,
} from '../../../../shared-kernel/errors/domain-error';
import { GetAttachmentDownloadUrlQuery } from '../queries/get-attachment-download-url.query';

@Injectable()
export class GetAttachmentDownloadUrlHandler implements QueryHandler<
  GetAttachmentDownloadUrlQuery,
  { url: string; fileName: string }
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  async execute(query: GetAttachmentDownloadUrlQuery): Promise<{ url: string; fileName: string }> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: query.attachmentId,
        expenseId: query.expenseId,
        organizationId: query.organizationId,
      },
    });
    if (!attachment) throw new EntityNotFoundError('Attachment', query.attachmentId);

    if (attachment.scanStatus !== 'clean') {
      throw new AttachmentNotSafeToDownloadError(attachment.scanStatus);
    }

    const url = await this.storage.getPresignedDownloadUrl(attachment.storageKey);
    return { url, fileName: attachment.fileName };
  }
}
