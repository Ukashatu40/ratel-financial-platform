// test/unit/integration/csv-provider.adapter.spec.ts
import { fail } from 'assert';
import {
  CsvParseError,
  CsvProviderAdapter,
} from '../../../src/integration/adapters/csv/csv-provider.adapter';
import { describe, it, expect } from '@jest/globals';

describe('CsvProviderAdapter', () => {
  const adapter = new CsvProviderAdapter();

  it('parses a well-formed CSV into rows', () => {
    const csv =
      'department,category,amountMinorUnits,currency,expenseDate\nEngineering,Cloud,5000,NGN,2026-08-01';
    const rows = adapter.parse(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].department).toBe('Engineering');
  });

  it('throws CsvParseError when a required header is missing', () => {
    const csv = 'department,category,amountMinorUnits\nEngineering,Cloud,5000'; // missing currency, expenseDate
    expect(() => adapter.parse(csv)).toThrow(CsvParseError);
  });

  it('throws CsvParseError with a message naming the missing headers', () => {
    const csv = 'department,vendor\nEngineering,AWS'; // has a real delimiter; missing category/amountMinorUnits/currency/expenseDate
    try {
      adapter.parse(csv);
      fail('expected CsvParseError to be thrown');
    } catch (err) {
      expect((err as Error).message).toContain('category');
      expect((err as Error).message).toContain('amountMinorUnits');
    }
  });

  it('trims whitespace from headers', () => {
    const csv =
      ' department , category ,amountMinorUnits,currency,expenseDate\nEngineering,Cloud,5000,NGN,2026-08-01';
    expect(() => adapter.parse(csv)).not.toThrow();
  });

  it('skips empty lines rather than treating them as malformed rows', () => {
    const csv =
      'department,category,amountMinorUnits,currency,expenseDate\nEngineering,Cloud,5000,NGN,2026-08-01\n\n';
    const rows = adapter.parse(csv);
    expect(rows).toHaveLength(1);
  });

  describe('with a column mapping', () => {
    it('remaps non-standard headers to canonical field names', () => {
      const csv = 'Dept,Cost Category,Amount,Curr,Txn Date\nEngineering,Cloud,5000,NGN,2026-08-01';
      const mapping = {
        department: 'Dept',
        category: 'Cost Category',
        amountMinorUnits: 'Amount',
        currency: 'Curr',
        expenseDate: 'Txn Date',
      };

      const rows = adapter.parse(csv, mapping);

      expect(rows[0].department).toBe('Engineering');
      expect(rows[0].amountMinorUnits).toBe('5000');
      expect((rows[0] as any).Dept).toBeUndefined(); // original header key should NOT survive remapping
    });

    it('throws when the mapping is missing a required field', () => {
      const csv = 'Dept,Amount\nEngineering,5000';
      const incompleteMapping = { department: 'Dept', amountMinorUnits: 'Amount' }; // missing category/currency/expenseDate

      expect(() => adapter.parse(csv, incompleteMapping)).toThrow(CsvParseError);
    });

    it('throws when a mapped source column does not actually exist in the file', () => {
      const csv = 'Dept,Amount,Curr,Txn Date\nEngineering,5000,NGN,2026-08-01'; // no "Cost Category" column
      const mapping = {
        department: 'Dept',
        category: 'Cost Category',
        amountMinorUnits: 'Amount',
        currency: 'Curr',
        expenseDate: 'Txn Date',
      };

      expect(() => adapter.parse(csv, mapping)).toThrow(CsvParseError);
    });

    it('ignores optional fields not present in the mapping (vendor, description)', () => {
      const csv = 'Dept,Cat,Amt,Cur,Dt\nEngineering,Cloud,5000,NGN,2026-08-01';
      const mapping = {
        department: 'Dept',
        category: 'Cat',
        amountMinorUnits: 'Amt',
        currency: 'Cur',
        expenseDate: 'Dt',
      };

      const rows = adapter.parse(csv, mapping);
      expect(rows[0].vendor).toBeUndefined();
    });
  });

  describe('without a mapping (existing behavior, must be unchanged)', () => {
    it('still requires the exact canonical headers', () => {
      const csv = 'Dept,Amount\nEngineering,5000'; // non-canonical headers, no mapping provided
      expect(() => adapter.parse(csv)).toThrow(CsvParseError);
    });
  });
});
