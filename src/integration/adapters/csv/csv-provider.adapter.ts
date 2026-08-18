// src/integration/adapters/csv/csv-provider.adapter.ts
import { Injectable } from '@nestjs/common';
import Papa from 'papaparse';
import {
  CanonicalCsvField,
  ColumnMappingConfig,
  REQUIRED_CSV_FIELDS,
  isCanonicalCsvField,
  validateColumnMappingShape,
} from '../../domain/canonical-csv-fields';

export interface CsvRow {
  department: string;
  category: string;
  vendor?: string;
  amountMinorUnits: string;
  currency: string;
  expenseDate: string;
  description?: string;
}

// Canonical field names, the required subset, and mapping-shape validation
// all live in `domain/canonical-csv-fields` — shared with the column-mapping
// application layer so the two can't drift apart.
export type { CanonicalCsvField, ColumnMappingConfig };

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
      // Shape validation runs here too, not just at save time: a mapping
      // persisted before validation existed (or hand-edited in the DB) must
      // still fail loudly against a real file rather than silently produce
      // half-empty rows.
      const problems = validateColumnMappingShape(mapping);
      if (problems.length > 0) {
        throw new CsvParseError(`Invalid column mapping: ${problems.join('; ')}`);
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
        Object.keys(mapping)
          .filter(isCanonicalCsvField)
          .forEach((canonical: CanonicalCsvField) => {
            const sourceHeader = mapping[canonical];
            if (sourceHeader) remapped[canonical] = row[sourceHeader];
          });
        return remapped as unknown as CsvRow;
      });
    }

    const missing = REQUIRED_CSV_FIELDS.filter((h) => !actualHeaders.includes(h));
    if (missing.length > 0) {
      throw new CsvParseError(
        `Missing required column(s): ${missing.join(', ')}. Save a column mapping if your file uses different header names.`,
      );
    }
    return result.data as unknown as CsvRow[];
  }
}
