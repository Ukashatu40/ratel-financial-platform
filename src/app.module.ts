// src/app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharedKernelModule } from './shared-kernel/shared-kernel.module';
// (add AuditModule — order matters: after SharedKernelModule since it needs DomainEventDispatcher, and it should exist before JobsModule starts dispatching, though NestJS resolves this via DI regardless of import order)
import { AuditModule } from './shared-kernel/audit/audit.module';
import { WorkflowModule } from './shared-kernel/workflow/workflow.module';
import { EncryptionModule } from './shared-kernel/encryption/encryption.module';
import { JobsModule } from './jobs/jobs.module';
import { FinancialPeriodModule } from './contexts/financial-period/financial-period.module';
import { ExpenseModule } from './contexts/expense/expense.module';
import { PayrollModule } from './contexts/payroll/payroll.module';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { ReportingModule } from './reporting/reporting.module';
import { IntegrationModule } from './integration/integration.module';
import { StorageModule } from './storage/storage.module';
import { ObservabilityModule } from './observability/observability.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
/**
 * Import order matters for readability, not execution — ConfigModule and
 * PrismaModule/SharedKernelModule are @Global(), so every context module
 * below can inject PrismaService, UNIT_OF_WORK, OutboxService, and
 * DomainEventDispatcher without re-importing them (Phase 4.3 module layout).
 *
 * New bounded contexts (Expense, Payroll, ...) get added to this `imports`
 * array as they're built — nothing else in this file changes.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    SharedKernelModule,
    WorkflowModule,
    EncryptionModule,
    AuditModule,
    AuthModule,
    StorageModule,
    ObservabilityModule,
    JobsModule, // <-- add, after Encryption/SharedKernel since it depends on both
    NotificationsModule,
    ReferenceDataModule,
    FinancialPeriodModule,
    ExpenseModule,
    PayrollModule,
    ReportingModule,
    IntegrationModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
