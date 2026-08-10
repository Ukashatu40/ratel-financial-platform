// src/integration/presentation/controllers/import.controller.ts
import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FastifyRequest } from 'fastify';
import { PrismaService } from '../../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EntityNotFoundError } from '../../../shared-kernel/errors/domain-error';
import { JwtAuthGuard } from '../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../shared-kernel/auth/user-principal';
import { IMPORT_JOB_NAME, IMPORT_JOB_QUEUE } from '../../../jobs/queues/import-job.queue';
import { OBJECT_STORAGE_PORT, ObjectStoragePort } from '../../../storage/object-storage.port';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — generous for CSV, deliberately capped

@ApiTags('Integration — CSV Import')
@ApiBearerAuth('access-token')
@Controller({ path: 'imports', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ImportController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(IMPORT_JOB_QUEUE) private readonly queue: Queue,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  @ApiOperation({
    summary:
      'Upload a CSV file for async bulk expense import (columns: department,category,vendor,amountMinorUnits,currency,expenseDate,description)',
  })
  @ApiConsumes('multipart/form-data')
  @RequirePermission('expense:create') // importing IS creating expenses in bulk — reuses the same permission, no new grant needed
  @Post()
  async create(
    @Req() req: FastifyRequest,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ importJobId: string }> {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } });
    if (!file) throw new BadRequestException('No file uploaded');

    const buffer = await file.toBuffer();
    const importJobId = randomUUID(); // generated up front so the storage key can reference it before the DB row exists
    const storageKey = `${user.organizationId}/imports/${importJobId}.csv`;

    await this.storage.upload(storageKey, buffer, 'text/csv');

    const importJob = await this.prisma.importJob.create({
      data: {
        id: importJobId,
        organizationId: user.organizationId,
        providerId: 'csv-upload',
        status: 'pending',
        initiatedById: user.id,
        storageKey,
      },
    });

    await this.queue.add(IMPORT_JOB_NAME, { importJobId: importJob.id });

    return { importJobId: importJob.id };
  }

  @ApiOperation({ summary: 'Check the status/progress of an import job' })
  @RequirePermission('expense:create')
  @Get(':jobId')
  async getStatus(@Param('jobId') jobId: string, @CurrentUser() user: UserPrincipal) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organizationId: user.organizationId },
    });
    if (!job) throw new EntityNotFoundError('ImportJob', jobId);

    return {
      id: job.id,
      status: job.status,
      totalRecords: job.totalRecords,
      successCount: job.successCount,
      failureCount: job.failureCount,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  @ApiOperation({ summary: 'List row-level failures for an import job' })
  @RequirePermission('expense:create')
  @Get(':jobId/errors')
  async getErrors(@Param('jobId') jobId: string, @CurrentUser() user: UserPrincipal) {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, organizationId: user.organizationId },
    });
    if (!job) throw new EntityNotFoundError('ImportJob', jobId);

    const errors = await this.prisma.failedImportRecord.findMany({
      where: { importJobId: jobId },
      orderBy: { rowNumber: 'asc' },
    });

    return errors.map((e) => ({
      rowNumber: e.rowNumber,
      rawRow: e.rawRow,
      errorMessage: e.errorMessage,
    }));
  }
}
