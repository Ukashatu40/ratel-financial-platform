// src/integration/domain/canonical-csv-fields.ts
/**
 * The canonical shape of an importable expense row — the single source of
 * truth for BOTH places that need to know it:
 *   - `CsvProviderAdapter`, which validates an uploaded file's headers (and
 *     a mapping's coverage of them) inside the import worker;
 *   - `SaveColumnMappingHandler`, which validates a mapping synchronously
 *     at save time, before it can ever reach a worker.
 *
 * These lists were previously duplicated across those two files
 * independently — the same silent-drift risk TECH_DEBT #37 closed for the
 * test-cleanup table list. Adding a canonical field now means editing one
 * array here rather than finding every copy.
 */

export const REQUIRED_CSV_FIELDS = [
  'department',
  'category',
  'amountMinorUnits',
  'currency',
  'expenseDate',
] as const;

/** Genuinely optional — both a row and a mapping are valid without these. */
export const OPTIONAL_CSV_FIELDS = ['vendor', 'description'] as const;

export const CANONICAL_CSV_FIELDS = [...REQUIRED_CSV_FIELDS, ...OPTIONAL_CSV_FIELDS] as const;

export type CanonicalCsvField = (typeof CANONICAL_CSV_FIELDS)[number];

/** canonical field -> the source column header it should be read from */
export type ColumnMappingConfig = Partial<Record<CanonicalCsvField, string>>;

export const isCanonicalCsvField = (key: string): key is CanonicalCsvField =>
  (CANONICAL_CSV_FIELDS as readonly string[]).includes(key);

const isUsableHeader = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Validates a mapping's SHAPE — that its keys are real canonical fields,
 * its values are usable column headers, and every required field is
 * covered. Deliberately does NOT check whether those source headers exist
 * in any particular file: that is file-specific and stays in the adapter,
 * which is the only place that has a file to check against.
 *
 * Returns a list of human-readable problems (empty means valid) rather
 * than throwing, so each caller can raise the error type appropriate to
 * its own layer — a `DomainError` (→ 400) at save time, a `CsvParseError`
 * (→ recorded against the ImportJob) inside the worker.
 */
export function validateColumnMappingShape(mapping: unknown): string[] {
  if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) {
    return ['Mapping must be an object of canonical field -> source column header'];
  }

  const problems: string[] = [];
  const asRecord = mapping as Record<string, unknown>;

  const unknownKeys = Object.keys(asRecord).filter((k) => !isCanonicalCsvField(k));
  if (unknownKeys.length > 0) {
    problems.push(
      `Unknown field(s): ${unknownKeys.join(', ')}. ` +
        `Valid fields are: ${CANONICAL_CSV_FIELDS.join(', ')}`,
    );
  }

  const missingRequired = REQUIRED_CSV_FIELDS.filter((f) => !isUsableHeader(asRecord[f]));
  if (missingRequired.length > 0) {
    problems.push(`Missing or invalid required field(s): ${missingRequired.join(', ')}`);
  }

  // Optional fields are fine when absent, but not when PRESENT and unusable
  // (e.g. `vendor: ""` or `vendor: 123`) — that's a caller mistake worth
  // reporting rather than silently ignoring. Required fields are excluded
  // here because `missingRequired` above already covers them.
  const unusableOptional = OPTIONAL_CSV_FIELDS.filter(
    (f) => f in asRecord && !isUsableHeader(asRecord[f]),
  );
  if (unusableOptional.length > 0) {
    problems.push(
      `Field(s) mapped to an empty or non-string source column: ${unusableOptional.join(', ')}`,
    );
  }

  return problems;
}
