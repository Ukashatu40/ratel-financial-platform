// src/integration/application/column-mapping/column-mapping.handlers.ts
import { Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../shared-kernel/cqrs/query-handler';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainError } from '../../../shared-kernel/errors/domain-error';
import { REQUIRED_CSV_FIELDS } from './required-fields';
import { SaveColumnMappingCommand } from './column-mapping.commands';
import { ListColumnMappingsQuery } from './column-mapping.queries';

export class InvalidColumnMappingError extends DomainError {
  readonly code = 'invalid-column-mapping';
  readonly httpStatus = 400;
  constructor(missing: string[]) {
    super(`Column mapping is missing required field(s): ${missing.join(', ')}`);
  }
}

@Injectable()
export class SaveColumnMappingHandler implements CommandHandler<
  SaveColumnMappingCommand,
  { id: string }
> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(cmd: SaveColumnMappingCommand): Promise<{ id: string }> {
    const missing = REQUIRED_CSV_FIELDS.filter((f: any) => !cmd.mapping[f]);
    if (missing.length > 0) throw new InvalidColumnMappingError(missing);

    const saved = await this.prisma.columnMapping.upsert({
      where: { organizationId_name: { organizationId: cmd.organizationId, name: cmd.name } },
      create: { organizationId: cmd.organizationId, name: cmd.name, mapping: cmd.mapping },
      update: { mapping: cmd.mapping },
    });
    return { id: saved.id };
  }
}

@Injectable()
export class ListColumnMappingsHandler implements QueryHandler<ListColumnMappingsQuery, any[]> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListColumnMappingsQuery) {
    return this.prisma.columnMapping.findMany({
      where: { organizationId: query.organizationId },
      orderBy: { name: 'asc' },
    });
  }
}
