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

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

/**
 * v1 uses a FIXED expected header schema (documented below), not
 * user-configurable column mapping — Phase 8.2 originally envisioned
 * per-upload configurable mapping (users have different spreadsheet
 * layouts); that's real, separate scope, deferred and tracked rather than
 * half-built here.
 *
 * Expected headers: department,category,vendor,amountMinorUnits,currency,expenseDate,description
 * (vendor and description are optional columns)
 */
@Injectable()
export class CsvProviderAdapter {
  readonly providerId = 'csv-upload';

  parse(rawContent: string): CsvRow[] {
    const result = Papa.parse<CsvRow>(rawContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (result.errors.length > 0) {
      throw new CsvParseError(
        `CSV parse failed at row ${result.errors[0].row}: ${result.errors[0].message}`,
      );
    }

    const requiredHeaders = [
      'department',
      'category',
      'amountMinorUnits',
      'currency',
      'expenseDate',
    ];
    const actualHeaders = result.meta.fields ?? [];
    const missing = requiredHeaders.filter((h) => !actualHeaders.includes(h));
    if (missing.length > 0) {
      throw new CsvParseError(`Missing required column(s): ${missing.join(', ')}`);
    }

    return result.data;
  }
}
