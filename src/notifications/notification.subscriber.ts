// src/notifications/notification.subscriber.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventDispatcher } from '../shared-kernel/events/domain-event-dispatcher';
import { DomainEvent } from '../shared-kernel/events/domain-event';
import { NOTIFICATION_JOB, NOTIFICATION_QUEUE } from '../jobs/queues/notification.queue';
import { NotificationTemplateType } from './templates/notification-templates';

interface RecipientResolution {
  recipientUserId: string;
  templateType: NotificationTemplateType;
  templateData: Record<string, unknown>;
}

/**
 * Registers per-event-type (not global like AuditSubscriber) — notification
 * intent is genuinely event-specific, unlike audit which wants everything.
 * Resolves WHO gets notified and WHAT data the template needs, then hands
 * off to the queue — actual email/SMS sending happens in the processor,
 * async, matching the outbox/import/audit pattern already established
 * throughout this build rather than sending synchronously inline here.
 */
@Injectable()
export class NotificationSubscriber implements OnModuleInit {
  private readonly logger = new Logger(NotificationSubscriber.name, { timestamp: true });
  constructor(
    private readonly dispatcher: DomainEventDispatcher,
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register('ExpenseApproved', (e) => this.handleExpenseApproved(e));
    this.dispatcher.register('ExpenseRejected', (e) => this.handleExpenseRejected(e));
    this.dispatcher.register('PayrollRunApproved', (e) => this.handlePayrollRunApproved(e));
  }

  private async handleExpenseApproved(event: DomainEvent): Promise<void> {
    const expense = await this.prisma.expense.findFirst({ where: { id: event.aggregateId } });
    if (!expense) return;

    // Notify the ORIGINAL REQUESTER, not the approver — the person who
    // needs to know their expense went through is whoever created it.
    await this.enqueue({
      recipientUserId: expense.sourceActorId,
      templateType: 'ExpenseApproved',
      templateData: {
        expenseNumber: expense.expenseNumber,
        amount: `${expense.currency} ${(Number(expense.amountMinorUnits) / 100).toFixed(2)}`,
        approverName: (event.payload['approverId'] as string) ?? 'a manager',
      },
    });
  }

  private async handleExpenseRejected(event: DomainEvent): Promise<void> {
    const expense = await this.prisma.expense.findFirst({ where: { id: event.aggregateId } });
    if (!expense) return;

    await this.enqueue({
      recipientUserId: expense.sourceActorId,
      templateType: 'ExpenseRejected',
      templateData: {
        expenseNumber: expense.expenseNumber,
        amount: `${expense.currency} ${(Number(expense.amountMinorUnits) / 100).toFixed(2)}`,
        reason: (event.payload['reason'] as string) ?? 'No reason provided',
      },
    });
  }

  private async handlePayrollRunApproved(event: DomainEvent): Promise<void> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: event.aggregateId },
      include: { payslips: { include: { employee: true } } },
    });
    if (!run) return;

    // Admin-facing notification — unchanged, still useful on its own
    // (confirms the RUN went through, distinct from each employee's
    // individual pay notification below).
    await this.enqueue({
      recipientUserId: run.createdById,
      templateType: 'PayrollRunApproved',
      templateData: { runMonth: run.runMonth.toISOString().slice(0, 7) },
    });

    for (const payslip of run.payslips) {
      if (!payslip.employee.userId) {
        // Genuinely expected, not an error — an Employee with no linked
        // User account has no login/email to notify. Logged at debug so
        // it's traceable without being alarming.
        this.logger.debug(
          `Employee ${payslip.employeeId} has no linked User account — skipping payslip notification`,
        );
        continue;
      }

      await this.enqueue({
        recipientUserId: payslip.employee.userId,
        templateType: 'PayslipReady',
        templateData: {
          runMonth: run.runMonth.toISOString().slice(0, 7),
          netPay: `${payslip.currency} ${(Number(payslip.netPayMinorUnits) / 100).toFixed(2)}`,
        },
      });
    }
  }
  private async enqueue(resolution: RecipientResolution): Promise<void> {
    await this.queue.add(NOTIFICATION_JOB, resolution);
  }
}
