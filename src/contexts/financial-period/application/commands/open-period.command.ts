// src/contexts/financial-period/application/commands/open-period.command.ts
export class OpenPeriodCommand {
  constructor(
    readonly organizationId: string,
    readonly startDate: Date,
    readonly endDate: Date,
  ) {}
}