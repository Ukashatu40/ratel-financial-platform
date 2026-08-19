// src/jobs/processors/attachment-scan.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../../storage/object-storage.port';
import { VIRUS_SCAN_PORT, VirusScanPort } from '../../shared-kernel/scanning/virus-scan.port';
import { ATTACHMENT_SCAN_QUEUE } from '../queues/attachment-scan.queue';

interface ScanJobPayload {
  attachmentId: string;
}

@Processor(ATTACHMENT_SCAN_QUEUE)
export class AttachmentScanProcessor extends WorkerHost {
  private readonly logger = new Logger(AttachmentScanProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    @Inject(VIRUS_SCAN_PORT) private readonly scanner: VirusScanPort,
  ) {
    super();
  }

  async process(job: Job<ScanJobPayload>): Promise<void> {
    const { attachmentId } = job.data;
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) {
      this.logger.warn(`Attachment ${attachmentId} not found — skipping scan`);
      return;
    }

    try {
      const buffer = await this.storage.download(attachment.storageKey);
      const result = await this.scanner.scan(buffer);

      await this.prisma.attachment.update({
        where: { id: attachmentId },
        data: { scanStatus: result },
      });

      if (result === 'infected') {
        this.logger.error(
          `INFECTED FILE DETECTED: attachment ${attachmentId} (${attachment.fileName}), uploaded by ${attachment.uploadedById}`,
        );
      } else {
        this.logger.log(
          `Attachment ${attachmentId} scanned clean (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Scan FAILED for attachment ${attachmentId} — attempt ${job.attemptsMade + 1}/${job.opts.attempts}: ${(err as Error).message}`,
      );
      throw err; // let BullMQ retry — leaves scanStatus as 'unscanned' (still correctly blocks download) until a retry succeeds or exhausts
    }
  }
}
