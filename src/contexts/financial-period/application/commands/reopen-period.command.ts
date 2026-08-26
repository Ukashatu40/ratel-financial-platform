// src/contexts/financial-period/application/commands/reopen-period.command.ts
export class ReopenPeriodCommand {
  constructor(
    readonly organizationId: string,
    readonly periodId: string,
    readonly reopenedById: string,
    /** Required. Ends up on the PeriodReopened payload and so in the audit log. */
    readonly reason: string,
  ) {}
}
