// src/integration/application/column-mapping/column-mapping.handlers.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainError, EntityNotFoundError } from '../../../shared-kernel/errors/domain-error';
import { validateColumnMappingShape } from '../../domain/canonical-csv-fields';
import { SaveColumnMappingCommand, DeleteColumnMappingCommand } from './column-mapping.commands';
import { ListColumnMappingsQuery } from './column-mapping.queries';

export class InvalidColumnMappingError extends DomainError {
  readonly code = 'invalid-column-mapping';
  readonly httpStatus = 400;
  constructor(problems: string[]) {
    super(`Invalid column mapping: ${problems.join('; ')}`);
  }
}

@Injectable()
export class SaveColumnMappingHandler implements CommandHandler<
  SaveColumnMappingCommand,
  { id: string }
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SaveColumnMappingCommand): Promise<{ id: string }> {
    // Validate the full shape (unknown keys, unusable values, missing
    // required fields) synchronously, HERE — a mapping that only fails once
    // it reaches the import worker surfaces to the user as an ImportJob
    // stuck in `failed` with the reason visible in server logs only. A 400
    // at save time is the actionable version of the same rejection.
    const problems = validateColumnMappingShape(cmd.mapping);
    if (problems.length > 0) throw new InvalidColumnMappingError(problems);

    const saved = await this.prisma.columnMapping.upsert({
      where: { organizationId_name: { organizationId: cmd.organizationId, name: cmd.name } },
      create: { organizationId: cmd.organizationId, name: cmd.name, mapping: cmd.mapping },
      update: { mapping: cmd.mapping },
    });
    return { id: saved.id };
  }
}

export interface ColumnMappingView {
  id: string;
  name: string;
  mapping: Record<string, string>;
  createdAt: Date;
}

@Injectable()
export class ListColumnMappingsHandler
  implements QueryHandler<ListColumnMappingsQuery, ColumnMappingView[]>
{
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListColumnMappingsQuery): Promise<ColumnMappingView[]> {
    const rows = await this.prisma.columnMapping.findMany({
      where: { organizationId: query.organizationId },
      orderBy: { name: 'asc' },
    });

    // Explicitly projected rather than returning raw Prisma rows: the caller
    // already knows its own organization, so echoing `organizationId` back
    // adds nothing and widens the response for no reason.
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      mapping: row.mapping as Record<string, string>,
      createdAt: row.createdAt,
    }));
  }
}

@Injectable()
export class DeleteColumnMappingHandler
  implements CommandHandler<DeleteColumnMappingCommand, void>
{
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A HARD delete, deliberately — the documented exception to this codebase's
   * soft-delete convention (critical convention #3), not an oversight.
   *
   * That convention exists so an `Expense`/`Payslip` can never end up
   * referencing a row that vanished. A `ColumnMapping` is referenced by
   * nothing: `ImportJob.resolvedMapping` SNAPSHOTS the mapping's content at
   * upload time and holds no FK back to this table, so no historical import
   * job's parse can be re-explained or damaged by the mapping it was parsed
   * with going away. There is nothing here for a soft delete to protect, and
   * an `isActive` column would add a filter that every read path (list,
   * resolve-at-upload) must remember — one miss and a "deleted" mapping is
   * silently usable again.
   *
   * Scoped by `organizationId` in the same statement as the id: another
   * organization's mapping must be indistinguishable from a missing one, so
   * this can't be used to probe for the existence of IDs it can't touch.
   */
  async execute(cmd: DeleteColumnMappingCommand): Promise<void> {
    const { count } = await this.prisma.columnMapping.deleteMany({
      where: { id: cmd.mappingId, organizationId: cmd.organizationId },
    });

    if (count === 0) throw new EntityNotFoundError('ColumnMapping', cmd.mappingId);
  }
}
