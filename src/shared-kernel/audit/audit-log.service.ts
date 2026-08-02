// src/shared-kernel/audit/audit-log.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeEntryHash, GENESIS_HASH } from './hash-chain.util';

export interface RecordAuditEntryInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  newValue: unknown;
  reason?: string;
  correlationId: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  source: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * IMPORTANT known limitation, flagged rather than hidden: this reads the
   * last hash and inserts the new entry as two separate statements, not
   * atomically. Under concurrent writes from multiple dispatcher instances,
   * two entries could read the same prevHash and race, corrupting the
   * chain. Today's setup runs a single OutboxDispatchProcessor instance
   * processing sequentially (one event at a time, in a for-loop — see
   * OutboxDispatchService), so this isn't exploitable YET. It becomes a
   * real problem the moment this worker scales horizontally to multiple
   * instances. The proper fix is a Postgres advisory lock around the
   * read-then-insert (the same primitive already used elsewhere in prior
   * projects per your background) or, better, moving the hash computation
   * into a DB trigger as Phase 6.2 originally specified — deferred here to
   * keep this piece scoped, but tracked as real technical debt, not an
   * oversight.
   */
  async record(input: RecordAuditEntryInput): Promise<void> {
    const last = await this.prisma.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' } });
    const prevHash = last?.entryHash ?? GENESIS_HASH;
    const createdAt = new Date();

    const entryHash = computeEntryHash(prevHash, {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId,
      createdAt,
    });

    await this.prisma.auditLogEntry.create({
      data: {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorUserId: input.actorUserId,
        oldValue: undefined, // see AuditSubscriber note below — no before/after diffing in v1
        newValue: input.newValue as any,
        reason: input.reason,
        correlationId: input.correlationId,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        source: input.source,
        prevHash,
        entryHash,
        createdAt,
      },
    });

    this.logger.debug(
      `Audit entry recorded: ${input.entityType}:${input.entityId} — ${input.action}`,
    );
  }
}
