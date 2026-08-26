// src/event-deliveries/presentation/event-delivery.controller.ts
import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  ListEventDeliveriesHandler,
  GetEventDeliveryByIdHandler,
  RetryEventDeliveryHandler,
  EventDeliveryView,
} from '../application/event-delivery.handlers';
import {
  ListEventDeliveriesQuery,
  GetEventDeliveryByIdQuery,
} from '../application/event-delivery.queries';
import { RetryEventDeliveryCommand } from '../application/event-delivery.commands';
import {
  EVENT_DELIVERY_STATUSES,
  parseEventDeliveryStatus,
} from '../application/event-delivery.status';

/**
 * The operator-facing surface TECH_DEBT #47 asked for. #9 made a lost subscriber
 * delivery durable and automatically retried; what was missing was any way to SEE
 * a delivery that exhausted its retries, or to redrive it once the underlying
 * cause was fixed. Until this existed, a `permanently_failed` row — which for
 * `AuditSubscriber` means a financial event absent from the audit trail — was
 * reachable only by an engineer with psql access.
 *
 * Shaped after `NotificationController` on purpose: #33/#34/#35 closed exactly
 * this gap for notifications (make failures visible, then give them a recovery
 * path), so the second instance of the pattern should not look novel.
 */
@ApiTags('Event Deliveries')
@ApiBearerAuth('access-token')
@Controller({ path: 'event-deliveries', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EventDeliveryController {
  constructor(
    private readonly listEventDeliveries: ListEventDeliveriesHandler,
    private readonly getEventDeliveryById: GetEventDeliveryByIdHandler,
    private readonly retryEventDelivery: RetryEventDeliveryHandler,
  ) {}

  @ApiOperation({
    summary: 'List failed event deliveries, optionally filtered by status',
    description:
      'A `permanently_failed` entry means a subscriber never processed that event and ' +
      'its downstream state is missing it — for AuditSubscriber, an audit entry that ' +
      'does not exist. The audit hash chain cannot reveal this: it proves entries were ' +
      'not altered, and a chain missing an entry is still a valid chain.',
  })
  @ApiQuery({ name: 'status', required: false, enum: EVENT_DELIVERY_STATUSES })
  @RequirePermission('event-delivery:manage')
  @Get()
  async list(
    @Query('status') status: string | undefined,
    @CurrentUser() user: UserPrincipal,
  ): Promise<EventDeliveryView[]> {
    return this.listEventDeliveries.execute(
      new ListEventDeliveriesQuery(user.organizationId, parseEventDeliveryStatus(status)),
    );
  }

  @ApiOperation({ summary: 'Get a single failed event delivery' })
  @RequirePermission('event-delivery:manage')
  @Get(':id')
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal,
  ): Promise<EventDeliveryView> {
    return this.getEventDeliveryById.execute(
      new GetEventDeliveryByIdQuery(id, user.organizationId),
    );
  }

  @ApiOperation({
    summary: 'Manually redeliver a permanently-failed event delivery',
    description:
      'Re-invokes ONLY the one subscriber that failed, never the whole event — the ' +
      'others already succeeded, and re-running them would duplicate their effects ' +
      '(NotificationSubscriber sends email). Returns 409 for a delivery that is not ' +
      'permanently_failed, including pending_retry, which already has a retry scheduled.',
  })
  @RequirePermission('event-delivery:manage')
  @Post(':id/retry')
  async retry(
    @Param('id') id: string,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ requeued: boolean }> {
    return this.retryEventDelivery.execute(new RetryEventDeliveryCommand(id, user.organizationId));
  }
}
