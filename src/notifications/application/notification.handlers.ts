// src/notifications/application/notification.handlers.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueryHandler } from '../../shared-kernel/cqrs/query-handler';
import { CommandHandler } from '../../shared-kernel/cqrs/command-handler';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainError, EntityNotFoundError } from '../../shared-kernel/errors/domain-error';
import { NOTIFICATION_JOB, NOTIFICATION_QUEUE } from '../../jobs/queues/notification.queue';
import { ListNotificationsQuery, GetNotificationByIdQuery } from './notification.queries';
import { RetryNotificationCommand } from './notification.commands';
import { NotificationLog as PrismaNotificationLog } from '@prisma/client';

export class NotificationNotFailedError extends DomainError {
  readonly code = 'notification-not-failed';
  readonly httpStatus = 409;
  constructor(status: string) {
    super(`Only failed notifications can be retried (current status: '${status}')`);
  }
}

@Injectable()
export class ListNotificationsHandler implements QueryHandler<
  ListNotificationsQuery,
  PrismaNotificationLog[]
> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: ListNotificationsQuery): Promise<PrismaNotificationLog[]> {
    return this.prisma.notificationLog.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // simple cap, not full cursor pagination — this is an admin/debugging view, not a high-volume list
    });
  }
}

@Injectable()
export class GetNotificationByIdHandler implements QueryHandler<
  GetNotificationByIdQuery,
  PrismaNotificationLog
> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: GetNotificationByIdQuery): Promise<PrismaNotificationLog> {
    const log = await this.prisma.notificationLog.findFirst({
      where: { id: query.notificationId, organizationId: query.organizationId },
    });
    if (!log) throw new EntityNotFoundError('NotificationLog', query.notificationId);
    return log;
  }
}

@Injectable()
export class RetryNotificationHandler implements CommandHandler<
  RetryNotificationCommand,
  { requeued: boolean }
> {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  async execute(cmd: RetryNotificationCommand): Promise<{ requeued: boolean }> {
    const log = await this.prisma.notificationLog.findFirst({
      where: { id: cmd.notificationId, organizationId: cmd.organizationId },
    });
    if (!log) throw new EntityNotFoundError('NotificationLog', cmd.notificationId);
    if (log.status !== 'failed') throw new NotificationNotFailedError(log.status);

    await this.queue.add(NOTIFICATION_JOB, {
      recipientUserId: log.recipientUserId,
      templateType: log.templateType,
      templateData: log.templateData,
    });

    return { requeued: true };
  }
}
