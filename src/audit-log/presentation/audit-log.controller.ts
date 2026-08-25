// src/audit-log/presentation/audit-log.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  AuditEntryView,
  ListAuditEntriesHandler,
} from '../application/list-audit-entries.handler';
import { ListAuditEntriesQuery } from '../application/list-audit-entries.query';
import { ListAuditEntriesDto } from './dto/list-audit-entries.dto';

const DEFAULT_LIMIT = 100;

/**
 * The audit trail's first read surface.
 *
 * `AuditSubscriber` has been writing entries since Phase 6, but nothing could read
 * them over HTTP — the audit module contained only a module, a service and a
 * subscriber. `audit:view` was seeded for the `auditor` role and referenced nowhere
 * in the codebase, so the role held a permission that guarded nothing and the trail
 * was reachable only via psql. Added alongside TECH_DEBT #8, because populating
 * `old_value` without this would have meant recording a diff nothing could return.
 *
 * Shaped after `EventDeliveryController` (#47) on purpose: a top-level supporting
 * surface over pipeline bookkeeping, not a bounded context.
 */
@ApiTags('Audit Log')
@ApiBearerAuth('access-token')
@Controller({ path: 'audit-entries', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AuditLogController {
  constructor(private readonly listAuditEntries: ListAuditEntriesHandler) {}

  @ApiOperation({
    summary: 'List audit log entries for the caller organization, newest first',
    description:
      'Each entry carries `oldValue` (the before-image of the fields that action ' +
      'changed) and `newValue` (the event payload, including a `changes` map). ' +
      '`oldValue` is null for creation events, which have no before-state, and for ' +
      'events whose aggregate changed something other than its own fields. ' +
      '`hashVersion` says which hash scheme produced `entryHash`: version 2 covers ' +
      'the payload, version 1 covers only who/what/when/action.',
  })
  @RequirePermission('audit:view')
  @Get()
  async list(
    @Query() dto: ListAuditEntriesDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<AuditEntryView[]> {
    return this.listAuditEntries.execute(
      new ListAuditEntriesQuery(
        user.organizationId,
        {
          entityType: dto.entityType,
          entityId: dto.entityId,
          actorUserId: dto.actorUserId,
          action: dto.action,
          // Constructed here rather than in the handler: the DTO guarantees a valid
          // ISO string, so this is the last point where the conversion can't throw.
          from: dto.from ? new Date(dto.from) : undefined,
          to: dto.to ? new Date(dto.to) : undefined,
        },
        dto.offset ?? 0,
        dto.limit ?? DEFAULT_LIMIT,
      ),
    );
  }
}
