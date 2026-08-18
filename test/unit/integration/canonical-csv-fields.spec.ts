// test/unit/integration/canonical-csv-fields.spec.ts
import {
  CANONICAL_CSV_FIELDS,
  OPTIONAL_CSV_FIELDS,
  REQUIRED_CSV_FIELDS,
  isCanonicalCsvField,
  validateColumnMappingShape,
} from '../../../src/integration/domain/canonical-csv-fields';
import { describe, it, expect } from '@jest/globals';

describe('canonical CSV fields', () => {
  const validMapping = {
    department: 'Dept',
    category: 'Cost Category',
    amountMinorUnits: 'Amount',
    currency: 'Curr',
    expenseDate: 'Txn Date',
  };

  it('exposes required + optional as one combined canonical list', () => {
    expect(CANONICAL_CSV_FIELDS).toEqual([...REQUIRED_CSV_FIELDS, ...OPTIONAL_CSV_FIELDS]);
  });

  describe('isCanonicalCsvField', () => {
    it('accepts every canonical field', () => {
      CANONICAL_CSV_FIELDS.forEach((f) => expect(isCanonicalCsvField(f)).toBe(true));
    });

    it('rejects anything else', () => {
      expect(isCanonicalCsvField('Dept')).toBe(false);
      expect(isCanonicalCsvField('')).toBe(false);
    });
  });

  describe('validateColumnMappingShape', () => {
    it('reports no problems for a mapping covering exactly the required fields', () => {
      expect(validateColumnMappingShape(validMapping)).toEqual([]);
    });

    it('reports no problems when valid optional fields are also mapped', () => {
      expect(
        validateColumnMappingShape({
          ...validMapping,
          vendor: 'Supplier',
          description: 'Memo',
        }),
      ).toEqual([]);
    });

    it('reports each missing required field by name', () => {
      const problems = validateColumnMappingShape({ department: 'Dept' });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('category');
      expect(problems[0]).toContain('amountMinorUnits');
      expect(problems[0]).toContain('currency');
      expect(problems[0]).toContain('expenseDate');
      expect(problems[0]).not.toContain('department'); // the one that WAS provided
    });

    it('rejects unknown keys and names the valid ones', () => {
      const problems = validateColumnMappingShape({ ...validMapping, totallyMadeUp: 'X' });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('totallyMadeUp');
      expect(problems[0]).toContain('department'); // the "valid fields are:" hint
    });

    // The gap this whole validator closes: these all used to save with a 200
    // and then fail inside the import worker, where the reason was only ever
    // visible in server logs.
    it.each([
      ['a non-string value', { ...validMapping, currency: 123 }],
      ['an empty-string value', { ...validMapping, currency: '' }],
      ['a whitespace-only value', { ...validMapping, currency: '   ' }],
      ['a null value', { ...validMapping, currency: null }],
    ])('rejects a required field mapped to %s', (_label, mapping) => {
      const problems = validateColumnMappingShape(mapping);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('currency');
    });

    it('rejects an optional field that is PRESENT but unusable', () => {
      const problems = validateColumnMappingShape({ ...validMapping, vendor: '' });

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('vendor');
    });

    it('accepts an optional field being absent entirely', () => {
      expect(validateColumnMappingShape(validMapping)).toEqual([]);
    });

    it('reports every category of problem at once rather than stopping at the first', () => {
      const problems = validateColumnMappingShape({
        department: 'Dept',
        bogus: 'X',
        vendor: '',
      });

      expect(problems).toHaveLength(3); // unknown key + missing required + unusable optional
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', [{ department: 'Dept' }]],
      ['a string', 'department=Dept'],
      ['a number', 7],
    ])('rejects %s as not an object at all', (_label, input) => {
      expect(validateColumnMappingShape(input)).toEqual([
        'Mapping must be an object of canonical field -> source column header',
      ]);
    });
  });
});
