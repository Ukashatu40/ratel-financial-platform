// src/integration/application/column-mapping/column-mapping.commands.ts
export class SaveColumnMappingCommand {
  constructor(
    readonly organizationId: string,
    readonly name: string,
    readonly mapping: Record<string, string>,
  ) {}
}

export class DeleteColumnMappingCommand {
  constructor(
    readonly organizationId: string,
    readonly mappingId: string,
  ) {}
}
