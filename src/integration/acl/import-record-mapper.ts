// src/integration/acl/import-record-mapper.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RawImportRecord } from '../domain/raw-import-record';
import { CreateExpenseCommand } from '../../contexts/expense/application/commands/create-expense.command';
import { importedSource } from '../../contexts/expense/domain/value-objects/expense-source';

export class ImportMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportMappingError';
  }
}

/**
 * Translates a provider-agnostic RawImportRecord into the EXACT SAME
 * CreateExpenseCommand a human-facing controller builds (Phase 3.3's
 * non-negotiable rule). Department and category must ALREADY exist —
 * these are governed reference data, not something an import should be
 * able to silently create. Vendor is more permissive: auto-created if not
 * found, since vendor lists are naturally open-ended and gatekeeping them
 * would make CSV import impractical for real invoice data.
 */
@Injectable()
export class ImportRecordMapper {
  constructor(private readonly prisma: PrismaService) {}

  async toCreateExpenseCommand(
    record: RawImportRecord,
    organizationId: string,
    importJobId: string,
    initiatedById: string,
  ): Promise<CreateExpenseCommand> {
    const department = await this.prisma.department.findFirst({
      where: {
        organizationId,
        name: { equals: record.departmentName, mode: 'insensitive' },
        isActive: true,
      },
    });
    if (!department) {
      throw new ImportMappingError(
        `Department "${record.departmentName}" does not exist or is inactive for this organization`,
      );
    }

    const category = await this.prisma.expenseCategory.findFirst({
      where: {
        organizationId,
        name: { equals: record.categoryName, mode: 'insensitive' },
        isActive: true,
      },
    });
    if (!category) {
      throw new ImportMappingError(
        `Category "${record.categoryName}" does not exist or is inactive for this organization`,
      );
    }

    let vendorId: string | undefined;
    if (record.vendorName) {
      // Deliberate choice: if a CSV import references a vendor name that
      // matches a DEACTIVATED vendor, reactivate it rather than treating
      // it as an error — an import naming a vendor is implicitly saying
      // "we're transacting with them again." This is consistent with
      // vendors already being the least strictly governed of the four
      // reference-data types (Phase 3.3's original reasoning: open-ended,
      // auto-creatable). Department/category deliberately do NOT get this
      // treatment — those stay hard-blocked until someone explicitly
      // reactivates them via the reference-data API.
      const vendor = await this.prisma.vendor.upsert({
        where: { organizationId_name: { organizationId, name: record.vendorName } },
        create: { organizationId, name: record.vendorName },
        update: { isActive: true },
      });
      vendorId = vendor.id;
    }

    return new CreateExpenseCommand(
      organizationId,
      importedSource(initiatedById, importJobId),
      record.amountMinorUnits,
      record.currency,
      category.id,
      department.id,
      record.expenseDate,
      vendorId,
      undefined,
      record.description,
    );
  }
}
