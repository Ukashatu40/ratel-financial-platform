// src/contexts/expense/application/commands/attach-file.command.ts
export class AttachFileCommand {
  constructor(
    readonly expenseId: string,
    readonly organizationId: string,
    readonly uploadedById: string,
    readonly fileName: string,
    readonly contentType: string,
    readonly buffer: Buffer,
  ) {}
}
