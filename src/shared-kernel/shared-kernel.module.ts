// src/shared-kernel/shared-kernel.module.ts
import { Global, Module } from '@nestjs/common';
import { DomainEventDispatcher } from './events/domain-event-dispatcher';
import { OutboxService } from './outbox/outbox.service';
import { PrismaUnitOfWork } from './unit-of-work/prisma-unit-of-work';
import { UNIT_OF_WORK } from './unit-of-work/unit-of-work.port';

@Global()
@Module({
  providers: [
    DomainEventDispatcher,
    OutboxService,
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
  ],
  exports: [DomainEventDispatcher, OutboxService, UNIT_OF_WORK],
})
export class SharedKernelModule {}