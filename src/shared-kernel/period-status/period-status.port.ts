// src/shared-kernel/period-status/period-status.port.ts
export interface PeriodRef {
  id: string;
  organizationId: string;
  startDate: Date;
  endDate: Date;
}

export interface PeriodStatusPort {
  isOpen(organizationId: string, periodId: string): Promise<boolean>;
  currentOpenPeriod(organizationId: string): Promise<PeriodRef | null>;
}

export const PERIOD_STATUS_PORT = Symbol('PERIOD_STATUS_PORT');