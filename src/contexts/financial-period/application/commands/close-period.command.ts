// src/contexts/financial-period/application/commands/close-period.command.ts
export class ClosePeriodCommand {
  constructor(
    readonly organizationId: string,
    readonly periodId: string,
    readonly closedById: string,
  ) {}
}