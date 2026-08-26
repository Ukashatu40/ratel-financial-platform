// src/audit-log/application/list-audit-entries.handler.ts
import { Injectable } from '@nestjs/common';
import { QueryHandler } from '../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAuditEntriesQuery } from './list-audit-entries.query';

/**
 * Projected explicitly rather than returning the Prisma row, for the same reason
 * EventDeliveryView and #22 do it: `organizationId` is on the row and the caller
 * already knows it, so echoing it back is noise. Naming the shape also means
 * widening this response has to be a deliberate edit here (#21's reasoning).
 */
export interface AuditEntryView {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  /** Before-image of the changed fields (TECH_DEBT #8); null for creation events. */
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  hashVersion: number;
  entryHash: string;
  prevHash: string;
  correlationId: string;
  createdAt: Date;
}

interface AuditLogEntryRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  hashVersion: number;
  entryHash: string;
  prevHash: string;
  correlationId: string;
  createdAt: Date;
}

const toView = (row: AuditLogEntryRow): AuditEntryView => ({
  id: row.id,
  entityType: row.entityType,
  entityId: row.entityId,
  action: row.action,
  actorUserId: row.actorUserId,
  oldValue: row.oldValue ?? null,
  newValue: row.newValue ?? null,
  reason: row.reason,
  hashVersion: row.hashVersion,
  entryHash: row.entryHash,
  prevHash: row.prevHash,
  correlationId: row.correlationId,
  createdAt: row.createdAt,
});

@Injectable()
export class ListAuditEntriesHandler
  implements QueryHandler<ListAuditEntriesQuery, AuditEntryView[]>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListAuditEntriesQuery): Promise<AuditEntryView[]> {
    // Organization in the SAME where clause as every filter, per #43's reasoning:
    // another organization's entries are simply not found, so this cannot be used
    // to enumerate what exists elsewhere. A separate fetch-then-compare would leave
    // a window in which the scope check and the read disagree.
    const rows = await this.prisma.auditLogEntry.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.filter.entityType ? { entityType: query.filter.entityType } : {}),
        ...(query.filter.entityId ? { entityId: query.filter.entityId } : {}),
        ...(query.filter.actorUserId ? { actorUserId: query.filter.actorUserId } : {}),
        ...(query.filter.action ? { action: query.filter.action } : {}),
        ...(query.filter.from || query.filter.to
          ? {
              createdAt: {
                ...(query.filter.from ? { gte: query.filter.from } : {}),
                ...(query.filter.to ? { lte: query.filter.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: query.skip,
      take: query.take,
    });

    return rows.map(toView);
  }
}
