// src/storage/storage.module.ts
import { Global, Module } from '@nestjs/common';
import { OBJECT_STORAGE_PORT } from './object-storage.port';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter';
import { BullModule } from '@nestjs/bullmq';
import { VIRUS_SCAN_PORT } from '../shared-kernel/scanning/virus-scan.port';
import { ClamAvScanAdapter } from './clamav-scan.adapter';
import { AttachmentScanProcessor } from '../jobs/processors/attachment-scan.processor';
import { ATTACHMENT_SCAN_QUEUE } from '../jobs/queues/attachment-scan.queue';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: ATTACHMENT_SCAN_QUEUE,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 3000 } },
    }),
  ],
  providers: [
    { provide: OBJECT_STORAGE_PORT, useClass: S3ObjectStorageAdapter },
    { provide: VIRUS_SCAN_PORT, useClass: ClamAvScanAdapter },
    AttachmentScanProcessor,
  ],
  // BullModule is re-exported so the ATTACHMENT_SCAN_QUEUE provider registered
  // above is visible to the *producer* side too — AttachFileHandler lives in
  // ExpenseModule and injects this queue. Registering the queue a second time
  // over there would create a second Queue instance that silently loses the
  // defaultJobOptions (attempts/backoff) configured here.
  exports: [OBJECT_STORAGE_PORT, VIRUS_SCAN_PORT, BullModule],
})
export class StorageModule {}
