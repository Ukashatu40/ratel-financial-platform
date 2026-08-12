// src/reference-data/application/vendor/vendor.queries.ts
export class GetVendorByIdQuery {
  constructor(
    readonly vendorId: string,
    readonly organizationId: string,
  ) {}
}
export class ListVendorsQuery {
  constructor(
    readonly organizationId: string,
    readonly includeInactive: boolean = false,
  ) {}
}
