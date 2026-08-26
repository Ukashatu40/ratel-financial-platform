// src/audit-log/application/list-audit-entries.query.ts
export interface ListAuditEntriesFilter {
  /** Undefined means "every entity type" — notably including types the caller didn't expect. */
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  /** Inclusive. ISO date string; `@IsDateString` guarantees format before this layer. */
  from?: Date;
  to?: Date;
}

export class ListAuditEntriesQuery {
  constructor(
    readonly organizationId: string,
    readonly filter: ListAuditEntriesFilter,
    readonly skip: number,
    readonly take: number,
  ) {}
}
