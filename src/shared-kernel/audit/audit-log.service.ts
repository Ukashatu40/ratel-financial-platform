// src/shared-kernel/audit/audit-log.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../unit-of-work/unit-of-work.port';
import { computeEntryHashV2, CURRENT_HASH_VERSION, GENESIS_HASH } from './hash-chain.util';
import { Prisma } from '@prisma/client';

export interface RecordAuditEntryInput {
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  /**
   * Before-image of the fields this action changed (TECH_DEBT #8). Undefined for
   * creation events and for events whose aggregate reported no field changes —
   * stored as NULL, which reads honestly as "there was no before-state" rather than
   * as an empty diff.
   */
  oldValue?: unknown;
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

      const entryHash = computeEntryHashV2(prevHash, {
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        createdAt,
        // v2 covers the payload too, so the diff in old_value cannot be rewritten
        // without breaking the chain.
        oldValue: input.oldValue,
        newValue: input.newValue,
        reason: input.reason,
      });

      await tx.auditLogEntry.create({
        data: {
          organizationId: input.organizationId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          actorUserId: input.actorUserId,
          oldValue:
            input.oldValue === undefined
              ? Prisma.DbNull
              : (input.oldValue as unknown as Prisma.InputJsonValue),
          newValue: input.newValue as unknown as Prisma.InputJsonValue,
          reason: input.reason,
          correlationId: input.correlationId,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          source: input.source,
          prevHash,
          entryHash,
          hashVersion: CURRENT_HASH_VERSION,
          createdAt,
        },
      });
    });

    this.logger.debug(
      `Audit entry recorded: ${input.entityType}:${input.entityId} — ${input.action}`,
    );
  }
}
