// src/event-deliveries/application/event-delivery.handlers.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { QueryHandler } from '../../shared-kernel/cqrs/query-handler';
import { CommandHandler } from '../../shared-kernel/cqrs/command-handler';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainError, EntityNotFoundError } from '../../shared-kernel/errors/domain-error';
import {
  EVENT_DELIVERY_RETRY_SCHEDULER,
  EventDeliveryRetryScheduler,
} from '../../shared-kernel/events/event-delivery-retry-scheduler.port';
import {
  ListEventDeliveriesQuery,
  GetEventDeliveryByIdQuery,
} from './event-delivery.queries';
import { RetryEventDeliveryCommand } from './event-delivery.commands';

/**
 * Projected explicitly rather than returning the Prisma row, for the reason #22
 * gave when it stopped `GET /imports/column-mappings` echoing raw rows:
 * `organizationId` is on the row and the caller already knows it, so sending it
 * back is noise at best. Naming the shape also means widening this response has
 * to be a deliberate edit here.
 */
export interface EventDeliveryView {
  id: string;
  outboxEventId: string;
  eventType: string;
  subscriberName: string;
  status: string;
  attempts: number;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
}

interface FailedEventDeliveryRow extends EventDeliveryView {
  organizationId: string;
}

const toView = (row: FailedEventDeliveryRow): EventDeliveryView => ({
  id: row.id,
  outboxEventId: row.outboxEventId,
  eventType: row.eventType,
  subscriberName: row.subscriberName,
  status: row.status,
  attempts: row.attempts,
  lastError: row.lastError,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Only a `permanently_failed` delivery can be redriven by hand.
 *
 * `recovered` needs nothing. `pending_retry` is refused for a concrete reason,
 * not fastidiousness: a live BullMQ job already exists for that row under the
 * jobId `redeliver-<id>`, so enqueueing another would be deduplicated into a
 * no-op and the operator would be told "requeued" while nothing happened. That
 * silent no-op is exactly the defect corrected under #9 — here the dedupe is the
 * CORRECT behaviour, so the honest move is to refuse the request rather than
 * absorb it.
 */
export class EventDeliveryNotRetryableError extends DomainError {
  readonly code = 'event-delivery-not-retryable';
  readonly httpStatus = 409;
  constructor(status: string) {
    super(
      `Only permanently_failed event deliveries can be retried manually ` +
        `(current status: '${status}'). A 'pending_retry' delivery already has an ` +
        `automatic retry scheduled.`,
    );
  }
}

@Injectable()
export class ListEventDeliveriesHandler
  implements QueryHandler<ListEventDeliveriesQuery, EventDeliveryView[]>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListEventDeliveriesQuery): Promise<EventDeliveryView[]> {
    const rows = await this.prisma.failedEventDelivery.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Same simple cap as GET /notifications: an operator/debugging view, not a
      // high-volume list, so cursor pagination would be machinery for its own sake.
      take: 100,
    });

    return rows.map(toView);
  }
}

@Injectable()
export class GetEventDeliveryByIdHandler
  implements QueryHandler<GetEventDeliveryByIdQuery, EventDeliveryView>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetEventDeliveryByIdQuery): Promise<EventDeliveryView> {
    // Organization in the SAME where clause as the id, per #43's reasoning: "not
    // yours" is indistinguishable from "doesn't exist", so this can't be used to
    // probe which delivery ids exist in other organizations.
    const row = await this.prisma.failedEventDelivery.findFirst({
      where: { id: query.deliveryId, organizationId: query.organizationId },
    });

    if (!row) throw new EntityNotFoundError('FailedEventDelivery', query.deliveryId);
    return toView(row);
  }
}

@Injectable()
export class RetryEventDeliveryHandler
  implements CommandHandler<RetryEventDeliveryCommand, { requeued: boolean }>
{
  private readonly logger = new Logger(RetryEventDeliveryHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_DELIVERY_RETRY_SCHEDULER)
    private readonly retryScheduler: EventDeliveryRetryScheduler,
  ) {}

  async execute(cmd: RetryEventDeliveryCommand): Promise<{ requeued: boolean }> {
    const row = await this.prisma.failedEventDelivery.findFirst({
      where: { id: cmd.deliveryId, organizationId: cmd.organizationId },
    });

    if (!row) throw new EntityNotFoundError('FailedEventDelivery', cmd.deliveryId);
    if (row.status !== 'permanently_failed') {
      throw new EventDeliveryNotRetryableError(row.status);
    }

    // Enqueue BEFORE flipping the status, deliberately. If the enqueue throws, the
    // row keeps saying `permanently_failed`, which is still true; the reverse
    // ordering would leave a row claiming `pending_retry` with no job in existence
    // and nothing to correct it — a lie no subsequent event repairs. If the status
    // write is what fails, the worker resolves the row on completion anyway, so
    // that direction is self-correcting.
    await this.retryScheduler.scheduleRetry(row.id);

    await this.prisma.failedEventDelivery.update({
      where: { id: row.id },
      data: { status: 'pending_retry' },
    });

    this.logger.log(
      `Operator requeued event delivery ${row.id}: subscriber "${row.subscriberName}" ` +
        `for ${row.eventType} (outbox event ${row.outboxEventId})`,
    );

    return { requeued: true };
  }
}
