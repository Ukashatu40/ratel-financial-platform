// src/contexts/expense/application/commands/create-adjustment.command.ts
export class CreateAdjustmentCommand {
  constructor(
    readonly originalExpenseId: string,
    readonly organizationId: string,
    readonly reason: string,
  ) {}
}