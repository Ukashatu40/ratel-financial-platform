// src/reference-data/application/category/category.queries.ts
export class GetCategoryByIdQuery {
  constructor(
    readonly categoryId: string,
    readonly organizationId: string,
  ) {}
}
export class ListCategoriesQuery {
  constructor(
    readonly organizationId: string,
    readonly includeInactive: boolean = false,
  ) {}
}
