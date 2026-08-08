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
      /**
       * Postgres advisory lock, scoped to this transaction (pg_advisory_xact_lock
       * auto-releases at commit/rollback, unlike the session-scoped variant —
       * no manual unlock needed, and it can't leak across requests). This
       * serializes every concurrent call to record() globally: a second
       * transaction attempting the same lock blocks here until the first
       * commits, which is exactly what closes the read-then-insert race from
       * TECH_DEBT #7 — no two entries can ever read the same prevHash again.
       *
       * hashtext('audit_log_chain') turns the fixed string into the bigint
       * key the lock function expects — a standard Postgres idiom for
       * advisory locks keyed by a stable name rather than a numeric constant
       * that has no inherent meaning on its own.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audit_log_chain'))`;

      const last = await tx.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' } });
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
