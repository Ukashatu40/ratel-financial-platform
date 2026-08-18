// src/integration/application/column-mapping/column-mapping.handlers.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainError } from '../../../shared-kernel/errors/domain-error';
import { validateColumnMappingShape } from '../../domain/canonical-csv-fields';
import { SaveColumnMappingCommand } from './column-mapping.commands';
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
