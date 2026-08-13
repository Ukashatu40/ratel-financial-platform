// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EMAIL_PROVIDER } from '../shared-kernel/notifications/email-provider.port';
import { SMS_PROVIDER } from '../shared-kernel/notifications/sms-provider.port';
import { SmtpEmailProvider } from './infrastructure/smtp-email-provider.adapter';
import { ConsoleSmsProvider } from './infrastructure/console-sms-provider.adapter';
import { NotificationSubscriber } from './notification.subscriber';
import { NotificationProcessor } from '../jobs/processors/notification.processor';
import { NOTIFICATION_QUEUE } from '../jobs/queues/notification.queue';
import { NotificationController } from './presentation/notification.controller';
import {
  ListNotificationsHandler,
  GetNotificationByIdHandler,
  RetryNotificationHandler,
} from './application/notification.handlers';

@Module({
  imports: [
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }, // BullMQ's native retry — no custom retry logic built
      },
    }),
  ],
  controllers: [NotificationController],
  providers: [
    { provide: EMAIL_PROVIDER, useClass: SmtpEmailProvider },
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    NotificationSubscriber,
    NotificationProcessor,
    ListNotificationsHandler,
    GetNotificationByIdHandler,
    RetryNotificationHandler, // <-- add
  ],
})
export class NotificationsModule {}
