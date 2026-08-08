// src/integration/inbox/inbox.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async alreadyProcessed(importJobId: string, sourceRecordHash: string): Promise<boolean> {
    const existing = await this.prisma.inboxRecord.findUnique({
      where: { importJobId_sourceRecordHash: { importJobId, sourceRecordHash } },
    });
    return existing !== null;
  }

  async markProcessed(importJobId: string, sourceRecordHash: string): Promise<void> {
    // Idempotency itself is enforced by the PK — a duplicate insert throws,
    // which the caller (ImportJobProcessor) catches and treats as already-processed
    // rather than a genuine failure (Phase 3.4).
    await this.prisma.inboxRecord.create({ data: { importJobId, sourceRecordHash } });
  }
}
