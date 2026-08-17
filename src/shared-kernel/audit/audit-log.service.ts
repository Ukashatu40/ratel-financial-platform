// src/shared-kernel/audit/audit-log.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../unit-of-work/unit-of-work.port';
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

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async record(input: RecordAuditEntryInput): Promise<void> {
    await this.uow.transaction(async (tx) => {
      // Lock key now includes organizationId — two DIFFERENT organizations
      // writing audit entries concurrently no longer serialize against
      // each other at all (previously the single global key would have
      // made every org's writes queue behind one another unnecessarily,
      // even though their chains were about to become independent below).
      const lockKey = `audit_log_chain:${input.organizationId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Scoped to THIS organization's chain only — this is the actual fix.
      // Before: walked the latest entry across every organization. Now:
      // walks the latest entry for the specific org being audited, so
      // proving chain integrity to one org's auditor never requires
      // exposing that other orgs' events shared the same sequence.
      const last = await tx.auditLogEntry.findFirst({
        where: { organizationId: input.organizationId },
        orderBy: { createdAt: 'desc' },
      });
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

      await tx.auditLogEntry.create({
        data: {
          organizationId: input.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          actorUserId: input.actorUserId,
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
    });

    this.logger.debug(
      `Audit entry recorded: ${input.entityType}:${input.entityId} — ${input.action}`,
    );
  }
}
