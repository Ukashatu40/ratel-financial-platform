// src/reference-data/application/project/project.commands.ts
export class CreateProjectCommand {
  constructor(
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class UpdateProjectCommand {
  constructor(
    readonly projectId: string,
    readonly organizationId: string,
    readonly name: string,
  ) {}
}
export class DeactivateProjectCommand {
  constructor(
    readonly projectId: string,
    readonly organizationId: string,
    readonly actorId: string,
  ) {}
}
