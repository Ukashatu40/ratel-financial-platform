// src/shared-kernel/shared-kernel.module.ts
import { Global, Module } from '@nestjs/common';
import { DomainEventDispatcher } from './events/domain-event-dispatcher';
import { OutboxService } from './outbox/outbox.service';
import { PrismaUnitOfWork } from './unit-of-work/prisma-unit-of-work';
import { UNIT_OF_WORK } from './unit-of-work/unit-of-work.port';
import { ResourceScopeRegistry } from './auth/resource-scope-registry';

@Global()
@Module({
  providers: [
    DomainEventDispatcher,
    OutboxService,
    ResourceScopeRegistry,
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
  ],
  exports: [DomainEventDispatcher, OutboxService, ResourceScopeRegistry, UNIT_OF_WORK],
})
export class SharedKernelModule {}
