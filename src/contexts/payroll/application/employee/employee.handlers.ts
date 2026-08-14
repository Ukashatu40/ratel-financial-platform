// src/contexts/payroll/application/employee/employee.handlers.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { DomainError, EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  referenceDataCreated,
  referenceDataDeactivated,
  referenceDataUpdated,
} from '../../../../reference-data/domain/reference-data.events';
import {
  CreateEmployeeCommand,
  DeactivateEmployeeCommand,
  LinkEmployeeToUserCommand,
  UnlinkEmployeeFromUserCommand,
} from './employee.commands';
import { GetEmployeeByIdQuery, ListEmployeesQuery } from './employee.queries';

export class UserAlreadyLinkedError extends DomainError {
  readonly code = 'user-already-linked';
  readonly httpStatus = 409;
  constructor(userId: string) {
    super(`User ${userId} is already linked to a different employee record`);
  }
}

@Injectable()
export class CreateEmployeeHandler implements CommandHandler<
  CreateEmployeeCommand,
  { id: string }
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: CreateEmployeeCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: { organizationId: cmd.organizationId, fullName: cmd.fullName },
      });
      await this.outbox.enqueue(
        [referenceDataCreated('Employee', employee.id, cmd.organizationId, cmd.fullName)],
        tx,
      );
      return { id: employee.id };
    });
  }
}

@Injectable()
export class LinkEmployeeToUserHandler implements CommandHandler<LinkEmployeeToUserCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: LinkEmployeeToUserCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: cmd.employeeId, organizationId: cmd.organizationId },
      });
      if (!employee) throw new EntityNotFoundError('Employee', cmd.employeeId);

      const collision = await tx.employee.findFirst({
        where: { userId: cmd.userId, id: { not: cmd.employeeId } },
      });
      if (collision) throw new UserAlreadyLinkedError(cmd.userId);

      const existingUser = await tx.user.findFirst({ where: { id: cmd.userId } });

      if (!existingUser) throw new EntityNotFoundError('User', cmd.userId);

      await tx.employee.update({ where: { id: cmd.employeeId }, data: { userId: cmd.userId } });
      await this.outbox.enqueue(
        [referenceDataUpdated('Employee', cmd.employeeId, cmd.organizationId, employee.fullName)],
        tx,
      );
    });
  }
}

@Injectable()
export class UnlinkEmployeeFromUserHandler implements CommandHandler<
  UnlinkEmployeeFromUserCommand,
  void
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: UnlinkEmployeeFromUserCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: cmd.employeeId, organizationId: cmd.organizationId },
      });
      if (!employee) throw new EntityNotFoundError('Employee', cmd.employeeId);
      await tx.employee.update({ where: { id: cmd.employeeId }, data: { userId: null } });
      await this.outbox.enqueue(
        [referenceDataUpdated('Employee', cmd.employeeId, cmd.organizationId, employee.fullName)],
        tx,
      );
    });
  }
}

@Injectable()
export class DeactivateEmployeeHandler implements CommandHandler<DeactivateEmployeeCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: DeactivateEmployeeCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: cmd.employeeId, organizationId: cmd.organizationId },
      });
      if (!employee) throw new EntityNotFoundError('Employee', cmd.employeeId);
      // Deliberately does NOT touch salaryStructures/payslips — historical
      // payroll records stay exactly as they are, same soft-delete
      // reasoning as every other reference-data type in this build.
      await tx.employee.update({ where: { id: cmd.employeeId }, data: { isActive: false } });
      await this.outbox.enqueue(
        [referenceDataDeactivated('Employee', cmd.employeeId, cmd.organizationId, cmd.actorId)],
        tx,
      );
    });
  }
}

@Injectable()
export class GetEmployeeByIdHandler implements QueryHandler<GetEmployeeByIdQuery, any> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: GetEmployeeByIdQuery) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: query.employeeId, organizationId: query.organizationId },
    });
    if (!employee) throw new EntityNotFoundError('Employee', query.employeeId);
    return employee;
  }
}

@Injectable()
export class ListEmployeesHandler implements QueryHandler<ListEmployeesQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: ListEmployeesQuery) {
    return this.prisma.employee.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { fullName: 'asc' },
    });
  }
}
