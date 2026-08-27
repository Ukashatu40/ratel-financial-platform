// src/shared-kernel/workflow/infrastructure/prisma-approval-progress.repository.ts
// src/shared-kernel/workflow/infrastructure/prisma-approval-progress.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransactionClient } from '../../unit-of-work/unit-of-work.port';
import { ApprovalChain, ApprovalStep } from '../approval-chain';
import { ApprovalProgress, ApprovalRecord } from '../approval-progress';
import { Prisma, ApprovalDecision as PrismaApprovalDecision } from '@prisma/client';
import { ApprovalProgressRepository } from '../approval-progress-repository.port';

/**
 * Lives in the shared kernel's own infrastructure folder (not under any one
 * context) since ApprovalProgress is a shared-kernel concept — Payroll will
 * use this exact same repository later, keyed by PayrollRun ids, without
 * any Expense-specific code in here (Phase 2.2: shared kernel, not context-owned).
 */
@Injectable()
export class PrismaApprovalProgressRepository implements ApprovalProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async initialize(
    itemId: string,
    itemType: string,
    chain: ApprovalChain,
    tx: TransactionClient,
  ): Promise<ApprovalProgress> {
    await tx.approvalProgress.create({
      data: {
        itemId,
        itemType,
        chain: chain.toArray() as unknown as Prisma.InputJsonValue,
      },
    });
    return ApprovalProgress.start(itemId, chain);
  }

  async findByItemId(itemId: string, tx?: TransactionClient): Promise<ApprovalProgress | null> {
    const client = tx ?? this.prisma;
    const row = await client.approvalProgress.findUnique({
      where: { itemId },
      include: { records: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!row) return null;

    const chain = ApprovalChain.of(row.chain as unknown as ApprovalStep[]);
    const records: ApprovalRecord[] = row.records.map((r) => ({
      stepOrder: r.stepOrder,
      approverId: r.approverId,
      decidedAt: r.decidedAt,
      decision: r.decision as 'approved' | 'rejected',
      reason: r.reason ?? undefined,
    }));

    return ApprovalProgress.reconstitute(itemId, chain, records);
  }

  async save(itemId: string, progress: ApprovalProgress, tx: TransactionClient): Promise<void> {
    const progressRow = await tx.approvalProgress.findUniqueOrThrow({ where: { itemId } });
    const existing = await tx.approvalRecord.findMany({ where: { progressId: progressRow.id } });
    const existingSteps = new Set(existing.map((r) => r.stepOrder));

    // Only insert records not already persisted — recordApproval/recordRejection
    // append to an in-memory array, so `save()` just needs to flush the delta.
    const newRecords = progress.getRecords().filter((r) => !existingSteps.has(r.stepOrder));
    if (newRecords.length === 0) return;

    await tx.approvalRecord.createMany({
      data: newRecords.map((r) => ({
        progressId: progressRow.id,
        stepOrder: r.stepOrder,
        approverId: r.approverId,
        decision: r.decision as PrismaApprovalDecision,
        reason: r.reason ?? null,
        decidedAt: r.decidedAt,
      })),
    });
  }
}
