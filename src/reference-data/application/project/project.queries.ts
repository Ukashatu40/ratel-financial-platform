// src/reference-data/application/project/project.queries.ts
export class GetProjectByIdQuery {
  constructor(
    readonly projectId: string,
    readonly organizationId: string,
  ) {}
}
export class ListProjectsQuery {
  constructor(
    readonly organizationId: string,
    readonly includeInactive: boolean = false,
  ) {}
}
