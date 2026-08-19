// src/integration/presentation/controllers/import.controller.ts
import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  Inject,
  Query,
  Body,
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
import {
  SaveColumnMappingHandler,
  ListColumnMappingsHandler,
  DeleteColumnMappingHandler,
} from '../../application/column-mapping/column-mapping.handlers';
import {
  SaveColumnMappingCommand,
  DeleteColumnMappingCommand,
} from '../../application/column-mapping/column-mapping.commands';
import { ListColumnMappingsQuery } from '../../application/column-mapping/column-mapping.queries';
import { SaveColumnMappingDto } from '../dto/save-column-mapping.dto';
import {
  UnsupportedImportFileError,
  validateCsvUpload,
} from '../../domain/csv-file-validation';

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
    private readonly saveColumnMapping: SaveColumnMappingHandler,
    private readonly listColumnMappings: ListColumnMappingsHandler,
    private readonly deleteColumnMapping: DeleteColumnMappingHandler,
  ) {}

  @ApiOperation({
    summary: 'Upload a CSV file — optionally pass ?mappingId= for a non-standard column layout',
  })
  @ApiConsumes('multipart/form-data')
  @RequirePermission('expense:create') // importing IS creating expenses in bulk — reuses the same permission, no new grant needed
  @Post()
  async create(
    @Req() req: FastifyRequest,
    @Query('mappingId') mappingId: string | undefined,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ importJobId: string }> {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } });
    if (!file) throw new BadRequestException('No file uploaded');

    let resolvedMapping: Record<string, string> | null = null;
    if (mappingId) {
      const saved = await this.prisma.columnMapping.findFirst({
        where: { id: mappingId, organizationId: user.organizationId },
      });
      if (!saved) throw new EntityNotFoundError('ColumnMapping', mappingId);
      resolvedMapping = saved.mapping as Record<string, string>;
    }

    const buffer = await file.toBuffer();

    // Validate BEFORE uploading: a file that can never be parsed should not
    // reach object storage at all, and the caller should hear about it
    // synchronously rather than by polling an ImportJob into `failed`.
    const problems = validateCsvUpload({ contentType: file.mimetype, buffer });
    if (problems.length > 0) throw new UnsupportedImportFileError(problems);

    const importJobId = randomUUID();
    const storageKey = `${user.organizationId}/imports/${importJobId}.csv`;

    await this.storage.upload(storageKey, buffer, 'text/csv'); // upload FIRST, same discipline as AttachFileHandler

    const importJob = await this.prisma.importJob.create({
      data: {
        id: importJobId,
        organizationId: user.organizationId,
        providerId: 'csv-upload',
        status: 'pending',
        initiatedById: user.id,
        storageKey,
        resolvedMapping: resolvedMapping as any,
      },
    });

    await this.queue.add(IMPORT_JOB_NAME, { importJobId: importJob.id });

    return { importJobId: importJob.id };
  }

  @ApiOperation({ summary: 'Save a reusable CSV column mapping' })
  @RequirePermission('expense:create')
  @Post('column-mappings')
  async saveMapping(@Body() dto: SaveColumnMappingDto, @CurrentUser() user: UserPrincipal) {
    return this.saveColumnMapping.execute(
      new SaveColumnMappingCommand(user.organizationId, dto.name, dto.mapping),
    );
  }

  @ApiOperation({ summary: 'List saved CSV column mappings' })
  @RequirePermission('expense:create')
  @Get('column-mappings')
  async listMappings(@CurrentUser() user: UserPrincipal) {
    return this.listColumnMappings.execute(new ListColumnMappingsQuery(user.organizationId));
  }

  @ApiOperation({
    summary: 'Delete a saved CSV column mapping',
    description:
      'Hard delete. Already-processed import jobs are unaffected — each snapshots the ' +
      'mapping content it was parsed with (ImportJob.resolvedMapping) and holds no ' +
      'reference to this row.',
  })
  @RequirePermission('expense:create')
  @Delete('column-mappings/:id')
  async deleteMapping(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deleteColumnMapping.execute(
      new DeleteColumnMappingCommand(user.organizationId, id),
    );
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
      // Only ever populated for a WHOLE-FILE failure (unfetchable/unparseable
      // file, bad mapping). Row-level failures stay in GET :jobId/errors.
      failureReason: job.failureReason,
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
