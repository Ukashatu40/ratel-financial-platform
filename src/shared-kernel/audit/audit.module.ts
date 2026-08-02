// src/shared-kernel/audit/audit.module.ts
import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditSubscriber } from './audit.subscriber';

@Global()
@Module({
  providers: [AuditLogService, AuditSubscriber],
  exports: [AuditLogService],
})
export class AuditModule {}
