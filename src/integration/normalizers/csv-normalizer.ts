// src/integration/normalizers/csv-normalizer.ts
import { Injectable } from '@nestjs/common';
import { CsvRow } from '../adapters/csv/csv-provider.adapter';
import { computeSourceRecordHash, RawImportRecord } from '../domain/raw-import-record';

export class CsvRowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvRowValidationError';
  }
}

@Injectable()
export class CsvNormalizer {
  normalize(row: CsvRow, rowNumber: number): RawImportRecord {
    if (!row.department?.trim())
      throw new CsvRowValidationError(`Row ${rowNumber}: department is required`);
    if (!row.category?.trim())
      throw new CsvRowValidationError(`Row ${rowNumber}: category is required`);
    if (!row.currency?.trim() || row.currency.trim().length !== 3) {
      throw new CsvRowValidationError(`Row ${rowNumber}: currency must be a 3-letter code`);
    }

    const amountMinorUnits = BigInt(row.amountMinorUnits?.trim() ?? '');
    if (amountMinorUnits <= 0n) {
      throw new CsvRowValidationError(
        `Row ${rowNumber}: amountMinorUnits must be a positive integer`,
      );
    }

    const expenseDate = new Date(row.expenseDate?.trim());
    if (isNaN(expenseDate.getTime())) {
      throw new CsvRowValidationError(`Row ${rowNumber}: expenseDate is not a valid date`);
    }

    return {
      externalId: `csv-row-${rowNumber}`,
      sourceRecordHash: computeSourceRecordHash(row as unknown as Record<string, string>),
      departmentName: row.department.trim(),
      categoryName: row.category.trim(),
      vendorName: row.vendor?.trim() || undefined,
      amountMinorUnits,
      currency: row.currency.trim().toUpperCase(),
      expenseDate,
      description: row.description?.trim() || undefined,
    };
  }
}
