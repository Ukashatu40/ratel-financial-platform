// src/reference-data/application/category/category.commands.ts
export class CreateCategoryCommand {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class UpdateCategoryCommand {
  constructor(
    readonly categoryId: string,
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class DeactivateCategoryCommand {
  constructor(
    readonly categoryId: string,
    readonly organizationId: string,
    readonly actorId: string,
  ) {}
}
