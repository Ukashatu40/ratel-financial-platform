// src/contexts/financial-period/financial-period.module.ts
import { Module } from '@nestjs/common';
import { FINANCIAL_PERIOD_REPOSITORY } from './domain/ports/financial-period-repository.port';
import { PrismaFinancialPeriodRepository } from './infrastructure/persistence/prisma-financial-period.repository';
import { PeriodStatusAdapter } from './infrastructure/adapters/period-status.adapter';
import { PERIOD_STATUS_PORT } from '../../shared-kernel/period-status/period-status.port';
import { OpenPeriodHandler } from './application/handlers/open-period.handler';
import { ClosePeriodHandler } from './application/handlers/close-period.handler';
import { GetCurrentOpenPeriodHandler } from './application/handlers/get-current-open-period.handler';
import { FinancialPeriodController } from './presentation/controllers/financial-period.controller';

@Module({
  controllers: [FinancialPeriodController],
  providers: [
    { provide: FINANCIAL_PERIOD_REPOSITORY, useClass: PrismaFinancialPeriodRepository },
    { provide: PERIOD_STATUS_PORT, useClass: PeriodStatusAdapter },
    OpenPeriodHandler,
    ClosePeriodHandler,
    GetCurrentOpenPeriodHandler,
  ],
  // PERIOD_STATUS_PORT exported so ExpenseModule / PayrollModule can import
  // FinancialPeriodModule and inject the port without knowing this context's
  // internals — the concrete realization of the Phase 3.2 Open-Host Service.
  exports: [PERIOD_STATUS_PORT],
})
export class FinancialPeriodModule {}