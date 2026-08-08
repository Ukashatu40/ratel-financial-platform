// src/integration/integration.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExpenseModule } from '../contexts/expense/expense.module';
import { CsvProviderAdapter } from './adapters/csv/csv-provider.adapter';
import { CsvNormalizer } from './normalizers/csv-normalizer';
import { InboxService } from './inbox/inbox.service';
import { ImportRecordMapper } from './acl/import-record-mapper';
import { ImportController } from './presentation/controllers/import.controller';
import { ImportJobProcessor } from '../jobs/processors/import-job.processor';
import { IMPORT_JOB_QUEUE } from '../jobs/queues/import-job.queue';

@Module({
  imports: [ExpenseModule, BullModule.registerQueue({ name: IMPORT_JOB_QUEUE })],
  controllers: [ImportController],
  providers: [
    CsvProviderAdapter,
    CsvNormalizer,
    InboxService,
    ImportRecordMapper,
    ImportJobProcessor,
  ],
})
export class IntegrationModule {}
