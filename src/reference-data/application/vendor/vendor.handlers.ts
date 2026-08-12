// src/reference-data/application/vendor/vendor.handlers.ts
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
import { DuplicateNameError } from '../department/department.handlers'; // reused, not redefined
import {
  CreateVendorCommand,
  DeactivateVendorCommand,
  UpdateVendorCommand,
} from './vendor.commands';
import { GetVendorByIdQuery, ListVendorsQuery } from './vendor.queries';

@Injectable()
export class CreateVendorHandler implements CommandHandler<CreateVendorCommand, { id: string }> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: CreateVendorCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const existing = await tx.vendor.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name },
      });
      if (existing) throw new DuplicateNameError(cmd.name);
      const vendor = await tx.vendor.create({
        data: { organizationId: cmd.organizationId, name: cmd.name },
      });
      await this.outbox.enqueue(
        [referenceDataCreated('Vendor', vendor.id, cmd.organizationId, cmd.name)],
        tx,
      );
      return { id: vendor.id };
    });
  }
}

@Injectable()
export class UpdateVendorHandler implements CommandHandler<UpdateVendorCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: UpdateVendorCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: cmd.vendorId, organizationId: cmd.organizationId },
      });
      if (!vendor) throw new EntityNotFoundError('Vendor', cmd.vendorId);
      const collision = await tx.vendor.findFirst({
        where: { organizationId: cmd.organizationId, name: cmd.name, id: { not: cmd.vendorId } },
      });
      if (collision) throw new DuplicateNameError(cmd.name);
      await tx.vendor.update({ where: { id: cmd.vendorId }, data: { name: cmd.name } });
      await this.outbox.enqueue(
        [referenceDataUpdated('Vendor', cmd.vendorId, cmd.organizationId, cmd.name)],
        tx,
      );
    });
  }
}

@Injectable()
export class DeactivateVendorHandler implements CommandHandler<DeactivateVendorCommand, void> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}
  async execute(cmd: DeactivateVendorCommand): Promise<void> {
    await this.uow.transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: cmd.vendorId, organizationId: cmd.organizationId },
      });
      if (!vendor) throw new EntityNotFoundError('Vendor', cmd.vendorId);
      await tx.vendor.update({ where: { id: cmd.vendorId }, data: { isActive: false } });
      await this.outbox.enqueue(
        [referenceDataDeactivated('Vendor', cmd.vendorId, cmd.organizationId, cmd.actorId)],
        tx,
      );
    });
  }
}

@Injectable()
export class GetVendorByIdHandler implements QueryHandler<GetVendorByIdQuery, any> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: GetVendorByIdQuery) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id: query.vendorId, organizationId: query.organizationId },
    });
    if (!vendor) throw new EntityNotFoundError('Vendor', query.vendorId);
    return vendor;
  }
}

@Injectable()
export class ListVendorsHandler implements QueryHandler<ListVendorsQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}
  async execute(query: ListVendorsQuery) {
    return this.prisma.vendor.findMany({
      where: {
        organizationId: query.organizationId,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }
}
