// src/reference-data/application/department/department.handlers.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../prisma/prisma.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../shared-kernel/outbox/outbox.service';
import { DomainError, EntityNotFoundError } from '../../../shared-kernel/errors/domain-error';
import {
  referenceDataCreated,
  referenceDataDeactivated,
  referenceDataUpdated,
} from '../../domain/reference-data.events';
import {
  CreateDepartmentCommand,
  DeactivateDepartmentCommand,
  UpdateDepartmentCommand,
} from './department.commands';
import { Department as PrismaDepartment } from '@prisma/client';
import { GetDepartmentByIdQuery, ListDepartmentsQuery } from './department.queries';

export class DuplicateNameError extends DomainError {
  readonly code = 'duplicate-name';
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A record named "${name}" already exists for this organization`);
  }
}

@Injectable()
export class CreateDepartmentHandler implements CommandHandler<
  CreateDepartmentCommand,
  { id: string }
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CreateDepartmentCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.department.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name },
      });
      if (existing) throw new DuplicateNameError(cmd.name);

      const department = await tx.department.create({
        data: { organizationId: cmd.organizationId, name: cmd.name },
      });
      await this.outbox.enqueue(
        [referenceDataCreated('Department', department.id, cmd.organizationId, cmd.name)],
        tx,
      );

      return { id: department.id };
    });
  }
}

@Injectable()
export class UpdateDepartmentHandler implements CommandHandler<UpdateDepartmentCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: UpdateDepartmentCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const department = await tx.department.findFirst({
        where: { id: cmd.departmentId, organizationId: cmd.organizationId },
      });
      if (!department) throw new EntityNotFoundError('Department', cmd.departmentId);

      const nameCollision = await tx.department.findFirst({
        where: {
          organizationId: cmd.organizationId,
          name: cmd.name,
          id: { not: cmd.departmentId },
        },
      });
      if (nameCollision) throw new DuplicateNameError(cmd.name);

      await tx.department.update({ where: { id: cmd.departmentId }, data: { name: cmd.name } });
      await this.outbox.enqueue(
        [referenceDataUpdated('Department', cmd.departmentId, cmd.organizationId, cmd.name)],
        tx,
      );
    });
  }
}

@Injectable()
export class DeactivateDepartmentHandler implements CommandHandler<
  DeactivateDepartmentCommand,
  void
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: DeactivateDepartmentCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const department = await tx.department.findFirst({
        where: { id: cmd.departmentId, organizationId: cmd.organizationId },
      });
      if (!department) throw new EntityNotFoundError('Department', cmd.departmentId);

      // Soft delete only — Expense.departmentId is a permanent historical
      // fact. Deactivating hides it from future selection (see TECH_DEBT
      // note below on enforcing that) without touching any existing record.
      await tx.department.update({ where: { id: cmd.departmentId }, data: { isActive: false } });
      await this.outbox.enqueue(
        [referenceDataDeactivated('Department', cmd.departmentId, cmd.organizationId, cmd.actorId)],
        tx,
      );
    });
  }
}

@Injectable()
export class GetDepartmentByIdHandler implements QueryHandler<
  GetDepartmentByIdQuery,
  PrismaDepartment
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetDepartmentByIdQuery): Promise<PrismaDepartment> {
    const department = await this.prisma.department.findFirst({
      where: { id: query.departmentId, organizationId: query.organizationId },
    });
    if (!department) throw new EntityNotFoundError('Department', query.departmentId);
    return department;
  }
}

@Injectable()
export class ListDepartmentsHandler implements QueryHandler<
  ListDepartmentsQuery,
  PrismaDepartment[]
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListDepartmentsQuery): Promise<PrismaDepartment[]> {
    return this.prisma.department.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }
}
