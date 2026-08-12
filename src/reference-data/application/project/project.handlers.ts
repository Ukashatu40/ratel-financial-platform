// src/reference-data/application/project/project.handlers.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../prisma/prisma.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../shared-kernel/errors/domain-error';
import {
  referenceDataCreated,
  referenceDataDeactivated,
  referenceDataUpdated,
} from '../../domain/reference-data.events';
import { DuplicateNameError } from '../department/department.handlers';
import {
  CreateProjectCommand,
  DeactivateProjectCommand,
  UpdateProjectCommand,
} from './project.commands';
import { GetProjectByIdQuery, ListProjectsQuery } from './project.queries';

@Injectable()
export class CreateProjectHandler implements CommandHandler<CreateProjectCommand, { id: string }> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: CreateProjectCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.project.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name },
      });
      if (existing) throw new DuplicateNameError(cmd.name);
      const project = await tx.project.create({
        data: { organizationId: cmd.organizationId, name: cmd.name },
      });
      await this.outbox.enqueue(
        [referenceDataCreated('Project', project.id, cmd.organizationId, cmd.name)],
        tx,
      );
      return { id: project.id };
    });
  }
}

@Injectable()
export class UpdateProjectHandler implements CommandHandler<UpdateProjectCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: UpdateProjectCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: cmd.projectId, organizationId: cmd.organizationId },
      });
      if (!project) throw new EntityNotFoundError('Project', cmd.projectId);
      const collision = await tx.project.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name, id: { not: cmd.projectId } },
      });
      if (collision) throw new DuplicateNameError(cmd.name);
      await tx.project.update({ where: { id: cmd.projectId }, data: { name: cmd.name } });
      await this.outbox.enqueue(
        [referenceDataUpdated('Project', cmd.projectId, cmd.organizationId, cmd.name)],
        tx,
      );
    });
  }
}

@Injectable()
export class DeactivateProjectHandler implements CommandHandler<DeactivateProjectCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: DeactivateProjectCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: cmd.projectId, organizationId: cmd.organizationId },
      });
      if (!project) throw new EntityNotFoundError('Project', cmd.projectId);
      await tx.project.update({ where: { id: cmd.projectId }, data: { isActive: false } });
      await this.outbox.enqueue(
        [referenceDataDeactivated('Project', cmd.projectId, cmd.organizationId, cmd.actorId)],
        tx,
      );
    });
  }
}

@Injectable()
export class GetProjectByIdHandler implements QueryHandler<GetProjectByIdQuery, any> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: GetProjectByIdQuery) {
    const project = await this.prisma.project.findFirst({
      where: { id: query.projectId, organizationId: query.organizationId },
    });
    if (!project) throw new EntityNotFoundError('Project', query.projectId);
    return project;
  }
}

@Injectable()
export class ListProjectsHandler implements QueryHandler<ListProjectsQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: ListProjectsQuery) {
    return this.prisma.project.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }
}
