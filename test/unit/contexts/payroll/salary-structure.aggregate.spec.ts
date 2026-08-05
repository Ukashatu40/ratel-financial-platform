// test/unit/contexts/payroll/salary-structure.aggregate.spec.ts
import { SalaryStructure } from '../../../../src/contexts/payroll/domain/aggregates/salary-structure.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { describe, expect, it } from '@jest/globals';

describe('SalaryStructure aggregate', () => {
  describe('createInitialVersion()', () => {
    it('starts at version 1 with no effectiveTo (currently active)', () => {
      const structure = SalaryStructure.createInitialVersion({
        organizationId: 'org-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
        ],
      });

      expect(structure.toProps().version).toBe(1);
      expect(structure.toProps().effectiveTo).toBeNull();
    });
  });

  describe('createNextVersion()', () => {
    it('increments the version number from the previous structure', () => {
      const v1 = SalaryStructure.createInitialVersion({
        organizationId: 'org-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [],
      });
      const v2 = SalaryStructure.createNextVersion(v1, {
        effectiveFrom: new Date('2026-08-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Raised Base', amount: Money.of(350000n, 'NGN') },
        ],
      });

      expect(v2.toProps().version).toBe(2);
    });

    it('does NOT mutate the previous version — v1 stays untouched', () => {
      const v1 = SalaryStructure.createInitialVersion({
        organizationId: 'org-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
        ],
      });
      const v1PropsBefore = v1.toProps();

      SalaryStructure.createNextVersion(v1, {
        effectiveFrom: new Date('2026-08-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Raised Base', amount: Money.of(350000n, 'NGN') },
        ],
      });

      expect(v1.toProps()).toEqual(v1PropsBefore); // v1 unchanged — proves the snapshot-safety invariant
    });

    it('preserves organizationId and employeeId from the previous version', () => {
      const v1 = SalaryStructure.createInitialVersion({
        organizationId: 'org-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [],
      });
      const v2 = SalaryStructure.createNextVersion(v1, {
        effectiveFrom: new Date('2026-08-01'),
        baseSalaryLineItems: [],
      });

      expect(v2.toProps().organizationId).toBe('org-1');
      expect(v2.toProps().employeeId).toBe('emp-1');
    });
  });

  describe('toSnapshot()', () => {
    it('produces a JSON-safe shape with serialized (not live) Money instances', () => {
      const structure = SalaryStructure.createInitialVersion({
        organizationId: 'org-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-01-01'),
        baseSalaryLineItems: [
          { kind: 'allowance', label: 'Base', amount: Money.of(300000n, 'NGN') },
        ],
      });

      const snapshot = structure.toSnapshot();

      // This is the exact bug we caught and fixed earlier — confirming it
      // stays fixed: the snapshot must be genuinely JSON.stringify-safe,
      // not contain live Money instances with private bigint fields.
      expect(() => JSON.stringify(snapshot)).not.toThrow();
      const roundTripped = JSON.parse(JSON.stringify(snapshot));
      expect(roundTripped.baseSalaryLineItems[0].amount.minorUnits).toBe('300000');
    });
  });
});
