// src/reference-data/application/vendor/vendor.commands.ts
export class CreateVendorCommand {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class UpdateVendorCommand {
  constructor(
    readonly vendorId: string,
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class DeactivateVendorCommand {
  constructor(
    readonly vendorId: string,
    readonly organizationId: string,
    readonly actorId: string,
  ) {}
}
