// src/contexts/expense/application/queries/list-attachments.query.ts
export class ListAttachmentsQuery {
  constructor(
    readonly expenseId: string,
    readonly organizationId: string,
  ) {}
}
