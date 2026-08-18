// src/contexts/expense/application/handlers/list-attachments.handler.ts
import { Injectable } from '@nestjs/common';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ListAttachmentsQuery } from '../queries/list-attachments.query';

@Injectable()
export class ListAttachmentsHandler implements QueryHandler<ListAttachmentsQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListAttachmentsQuery) {
    const attachments = await this.prisma.attachment.findMany({
      where: { expenseId: query.expenseId, organizationId: query.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      scanStatus: a.scanStatus,
      createdAt: a.createdAt,
    }));
  }
}
