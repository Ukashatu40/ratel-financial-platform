// src/jobs/processors/import-job.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CsvProviderAdapter,
  CsvParseError,
} from '../../integration/adapters/csv/csv-provider.adapter';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../../storage/object-storage.port';
import { CsvNormalizer, CsvRowValidationError } from '../../integration/normalizers/csv-normalizer';
import { InboxService } from '../../integration/inbox/inbox.service';
import { ImportMappingError, ImportRecordMapper } from '../../integration/acl/import-record-mapper';
import { CreateExpenseHandler } from '../../contexts/expense/application/handlers/create-expense.handler';
import { IMPORT_JOB_QUEUE } from '../queues/import-job.queue';

interface ImportJobPayload {
  importJobId: string;
}

@Processor(IMPORT_JOB_QUEUE)
export class ImportJobProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportJobProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly csvAdapter: CsvProviderAdapter,
    private readonly normalizer: CsvNormalizer,
    private readonly inbox: InboxService,
    private readonly mapper: ImportRecordMapper,
    private readonly createExpense: CreateExpenseHandler, // the SAME handler manual creation uses
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<void> {
    const { importJobId } = job.data;
    const importJob = await this.prisma.importJob.findUniqueOrThrow({ where: { id: importJobId } });

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: 'processing' },
    });

    let rows;
    try {
      const buffer = await this.storage.download(importJob.storageKey); // was: importJob.rawContent directly
      rows = this.csvAdapter.parse(buffer.toString('utf8'));
    } catch (err) {
      await this.prisma.importJob.update({
        where: { id: importJobId },
        data: { status: 'failed', completedAt: new Date() },
      });
      this.logger.error(
        `Import job ${importJobId} failed to fetch/parse: ${(err as Error).message}`,
      );
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row — matches what a human sees opening the CSV
      const rawRow = rows[i];

      try {
        const record = this.normalizer.normalize(rawRow, rowNumber);

        if (await this.inbox.alreadyProcessed(importJobId, record.sourceRecordHash)) {
          // Replay protection (Phase 3.4) — this exact row content was
          // already successfully processed in a prior attempt at this job.
          // Not a failure; just skipped.
          continue;
        }

        const command = await this.mapper.toCreateExpenseCommand(
          record,
          importJob.organizationId,
          importJobId,
          importJob.initiatedById,
        );

        // THE non-negotiable line (Phase 3.3): identical command handler
        // to what a human-facing controller calls. No import-only bypass.
        await this.createExpense.execute(command);

        await this.inbox.markProcessed(importJobId, record.sourceRecordHash);
        successCount++;
      } catch (err) {
        failureCount++;
        const message =
          err instanceof CsvRowValidationError || err instanceof ImportMappingError
            ? err.message
            : `Unexpected error: ${(err as Error).message}`;

        await this.prisma.failedImportRecord.create({
          data: { importJobId, rowNumber, rawRow: rawRow as any, errorMessage: message },
        });
        this.logger.warn(`Import job ${importJobId} row ${rowNumber} failed: ${message}`);
      }
    }

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: {
        status: 'completed',
        totalRecords: rows.length,
        successCount,
        failureCount,
        completedAt: new Date(),
      },
    });

    this.logger.log(
      `Import job ${importJobId} completed: ${successCount} succeeded, ${failureCount} failed`,
    );
  }
}
