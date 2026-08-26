// src/contexts/financial-period/application/queries/get-period-by-id.query.ts
export class GetPeriodByIdQuery {
  constructor(
    readonly periodId: string,
    readonly organizationId: string,
  ) {}
}
