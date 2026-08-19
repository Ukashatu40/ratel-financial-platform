// src/contexts/expense/application/queries/get-attachment-download-url.query.ts
export class GetAttachmentDownloadUrlQuery {
  constructor(
    readonly expenseId: string,
    readonly attachmentId: string,
    readonly organizationId: string,
  ) {}
}
