// src/integration/adapters/csv/csv-provider.adapter.ts
import { Injectable } from '@nestjs/common';
import Papa from 'papaparse';

export interface CsvRow {
  department: string;
  category: string;
  vendor?: string;
  amountMinorUnits: string;
  currency: string;
  expenseDate: string;
  description?: string;
}

export type CanonicalCsvField =
  | 'department'
  | 'category'
  | 'vendor'
  | 'amountMinorUnits'
  | 'currency'
  | 'expenseDate'
  | 'description';
export type ColumnMappingConfig = Partial<Record<CanonicalCsvField, string>>; // canonical field -> source column header

const REQUIRED_FIELDS: CanonicalCsvField[] = [
  'department',
  'category',
  'amountMinorUnits',
  'currency',
  'expenseDate',
];

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

@Injectable()
export class CsvProviderAdapter {
  readonly providerId = 'csv-upload';

  /**
   * Without a mapping: requires the exact canonical header set (unchanged
   * behavior from before this piece — nothing breaks for existing callers).
   * With a mapping: accepts ANY header names, remapping each row's keys
   * from the source header to the canonical field name BEFORE returning —
   * this is what lets CsvNormalizer stay completely unaware that mapping
   * even exists, since it always receives canonically-shaped rows either way.
   */
  parse(rawContent: string, mapping?: ColumnMappingConfig): CsvRow[] {
    const result = Papa.parse<Record<string, string>>(rawContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    const fatalErrors = result.errors.filter((e) => e.type !== 'Delimiter');
    if (fatalErrors.length > 0) {
      throw new CsvParseError(
        `CSV parse failed at row ${fatalErrors[0].row}: ${fatalErrors[0].message}`,
      );
    }

    const actualHeaders = result.meta.fields ?? [];

    if (mapping) {
      const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);
      if (missingRequired.length > 0) {
        throw new CsvParseError(
          `Column mapping is missing required field(s): ${missingRequired.join(', ')}`,
        );
      }

      for (const [canonical, sourceHeader] of Object.entries(mapping)) {
        if (sourceHeader && !actualHeaders.includes(sourceHeader)) {
          throw new CsvParseError(
            `Mapped column "${sourceHeader}" (for "${canonical}") was not found in the uploaded file. File headers: ${actualHeaders.join(', ')}`,
          );
        }
      }

      return result.data.map((row) => {
        const remapped: Record<string, string> = {};
        (Object.keys(mapping) as CanonicalCsvField[]).forEach((canonical) => {
          const sourceHeader = mapping[canonical];
          if (sourceHeader) remapped[canonical] = row[sourceHeader];
        });
        return remapped as unknown as CsvRow;
      });
    }

    const missing = REQUIRED_FIELDS.filter((h) => !actualHeaders.includes(h));
    if (missing.length > 0) {
      throw new CsvParseError(
        `Missing required column(s): ${missing.join(', ')}. Save a column mapping if your file uses different header names.`,
      );
    }
    return result.data as unknown as CsvRow[];
  }
}
