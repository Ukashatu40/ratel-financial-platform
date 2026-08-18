// test/unit/integration/csv-normalizer.spec.ts
import {
  CsvNormalizer,
  CsvRowValidationError,
} from '../../../src/integration/normalizers/csv-normalizer';
import { CsvRow } from '../../../src/integration/adapters/csv/csv-provider.adapter';
import { describe, it, expect } from '@jest/globals';

function validRow(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    department: 'Engineering',
    category: 'Cloud Services',
    vendor: 'AWS',
    amountMinorUnits: '5000',
    currency: 'ngn',
    expenseDate: '2026-08-15',
    description: 'test',
    ...overrides,
  };
}

describe('CsvNormalizer', () => {
  const normalizer = new CsvNormalizer();

  it('normalizes a valid row into a RawImportRecord', () => {
    const record = normalizer.normalize(validRow(), 2);
    expect(record.departmentName).toBe('Engineering');
    expect(record.amountMinorUnits).toBe(5000n);
    expect(record.currency).toBe('NGN'); // uppercased
  });

  it('trims whitespace from department/category/vendor', () => {
    const record = normalizer.normalize(
      validRow({ department: '  Engineering  ', category: '  Cloud  ' }),
      2,
    );
    expect(record.departmentName).toBe('Engineering');
    expect(record.categoryName).toBe('Cloud');
  });

  it('leaves vendor undefined when the CSV field is empty', () => {
    const record = normalizer.normalize(validRow({ vendor: '' }), 2);
    expect(record.vendorName).toBeUndefined();
  });

  it.each([
    ['missing department', { department: '' }, 'department is required'],
    ['missing category', { category: '' }, 'category is required'],
    ['non-3-letter currency', { currency: 'N' }, 'currency must be a 3-letter code'],
    ['zero amount', { amountMinorUnits: '0' }, 'must be a positive integer'],
    ['negative amount', { amountMinorUnits: '-100' }, 'must be a positive integer'],
    ['invalid date', { expenseDate: 'not-a-date' }, 'not a valid date'],
  ])('rejects %s', (_label, overrides, expectedMessage) => {
    expect(() => normalizer.normalize(validRow(overrides as Partial<CsvRow>), 5)).toThrow(
      CsvRowValidationError,
    );
    try {
      normalizer.normalize(validRow(overrides as Partial<CsvRow>), 5);
    } catch (err) {
      expect((err as Error).message).toContain(expectedMessage);
      expect((err as Error).message).toContain('Row 5'); // row number surfaces in the error, needed for the /errors endpoint
    }
  });

  it('throws on a non-numeric amountMinorUnits rather than silently coercing', () => {
    expect(() => normalizer.normalize(validRow({ amountMinorUnits: 'not-a-number' }), 2)).toThrow();
  });
});
