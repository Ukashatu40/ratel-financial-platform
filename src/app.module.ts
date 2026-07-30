// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharedKernelModule } from './shared-kernel/shared-kernel.module';
import { FinancialPeriodModule } from './contexts/financial-period/financial-period.module';
import { AppController } from './app.controller';

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
    FinancialPeriodModule,
  ],
  controllers: [AppController],
})
export class AppModule {}