// src/audit-log/audit-log.module.ts
import { Module } from '@nestjs/common';
import { AuditLogController } from './presentation/audit-log.controller';
import { ListAuditEntriesHandler } from './application/list-audit-entries.handler';

/**
 * A top-level supporting module beside `EventDeliveriesModule`, NOT a bounded context
 * — bounded contexts live under `src/contexts/`. Audit entries have no aggregate, no
 * state machine and no business rules; they are an append-only record, so full DDD
 * layering would be ceremony. Same call #47 made for failed event deliveries.
 *
 * Deliberately separate from `AuditModule` (`src/shared-kernel/audit/`), which owns
 * WRITING the trail. The shared kernel must not contain HTTP concerns — a controller
 * there would put presentation inside the layer every context depends on, inverting
 * the Phase 4.3 dependency rule. Reading is a supporting-module concern; writing
 * stays in the kernel.
 */
@Module({
  controllers: [AuditLogController],
  providers: [ListAuditEntriesHandler],
})
export class AuditLogModule {}
