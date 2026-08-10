// src/jobs/processors/notification.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from '../../shared-kernel/notifications/email-provider.port';
import {
  getSubjectFor,
  NotificationTemplateType,
  renderTemplate,
} from '../../notifications/templates/notification-templates';
import { NOTIFICATION_QUEUE } from '../queues/notification.queue';

interface NotificationJobPayload {
  recipientUserId: string;
  templateType: NotificationTemplateType;
  templateData: Record<string, unknown>;
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    super();
  }

  async process(job: Job<NotificationJobPayload>): Promise<void> {
    const { recipientUserId, templateType, templateData } = job.data;

    const user = await this.prisma.user.findUnique({ where: { id: recipientUserId } });
    if (!user) {
      this.logger.warn(`Notification recipient ${recipientUserId} not found — skipping`);
      return;
    }

    const roleAssignment = await this.prisma.userRoleAssignment.findFirst({
      where: { userId: recipientUserId },
    });

    const log = await this.prisma.notificationLog.create({
      data: {
        id: randomUUID(),
        organizationId: roleAssignment?.organizationId ?? 'unknown',
        recipientUserId,
        channel: 'email',
        templateType,
        status: 'pending',
      },
    });

    try {
      await this.emailProvider.send({
        to: user.email,
        subject: getSubjectFor(templateType),
        html: renderTemplate(templateType, templateData),
      });
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent', sentAt: new Date() },
      });

      this.logger.log(
        `Notification sent: ${templateType} to ${user.email} (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
      );
    } catch (err) {
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: (err as Error).message },
      });

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.error(
        `Notification FAILED: ${templateType} to ${user.email} — attempt ${job.attemptsMade + 1}/${job.opts.attempts} — ` +
          `${isLastAttempt ? 'PERMANENTLY FAILED, no more retries' : 'will retry'} — ${(err as Error).message}`,
      );

      throw err; // still rethrown — BullMQ needs this to actually trigger its retry mechanism, unchanged
    }
  }
}
