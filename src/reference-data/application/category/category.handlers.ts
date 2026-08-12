// src/reference-data/application/category/category.handlers.ts
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
  CreateCategoryCommand,
  DeactivateCategoryCommand,
  UpdateCategoryCommand,
} from './category.commands';
import { GetCategoryByIdQuery, ListCategoriesQuery } from './category.queries';

@Injectable()
export class CreateCategoryHandler implements CommandHandler<
  CreateCategoryCommand,
  { id: string }
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: CreateCategoryCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.expenseCategory.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name },
      });
      if (existing) throw new DuplicateNameError(cmd.name);
      const category = await tx.expenseCategory.create({
        data: { organizationId: cmd.organizationId, name: cmd.name },
      });
      await this.outbox.enqueue(
        [referenceDataCreated('ExpenseCategory', category.id, cmd.organizationId, cmd.name)],
        tx,
      );
      return { id: category.id };
    });
  }
}

@Injectable()
export class UpdateCategoryHandler implements CommandHandler<UpdateCategoryCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: UpdateCategoryCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const category = await tx.expenseCategory.findFirst({
        where: { id: cmd.categoryId, organizationId: cmd.organizationId },
      });
      if (!category) throw new EntityNotFoundError('ExpenseCategory', cmd.categoryId);
      const collision = await tx.expenseCategory.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name, id: { not: cmd.categoryId } },
      });
      if (collision) throw new DuplicateNameError(cmd.name);
      await tx.expenseCategory.update({ where: { id: cmd.categoryId }, data: { name: cmd.name } });
      await this.outbox.enqueue(
        [referenceDataUpdated('ExpenseCategory', cmd.categoryId, cmd.organizationId, cmd.name)],
        tx,
      );
    });
  }
}

@Injectable()
export class DeactivateCategoryHandler implements CommandHandler<DeactivateCategoryCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: DeactivateCategoryCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const category = await tx.expenseCategory.findFirst({
        where: { id: cmd.categoryId, organizationId: cmd.organizationId },
      });
      if (!category) throw new EntityNotFoundError('ExpenseCategory', cmd.categoryId);
      await tx.expenseCategory.update({ where: { id: cmd.categoryId }, data: { isActive: false } });
      await this.outbox.enqueue(
        [
          referenceDataDeactivated(
            'ExpenseCategory',
            cmd.categoryId,
            cmd.organizationId,
            cmd.actorId,
          ),
        ],
        tx,
      );
    });
  }
}

@Injectable()
export class GetCategoryByIdHandler implements QueryHandler<GetCategoryByIdQuery, any> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: GetCategoryByIdQuery) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: query.categoryId, organizationId: query.organizationId },
    });
    if (!category) throw new EntityNotFoundError('ExpenseCategory', query.categoryId);
    return category;
  }
}

@Injectable()
export class ListCategoriesHandler implements QueryHandler<ListCategoriesQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: ListCategoriesQuery) {
    return this.prisma.expenseCategory.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }
}
