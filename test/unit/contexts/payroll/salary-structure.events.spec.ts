import {
  salaryStructureCreated,
  salaryStructureVersionCreated,
} from '../../../../src/contexts/payroll/domain/events/salary-structure.events';
import { describe, expect, it } from '@jest/globals';

describe('salaryStructureCreated', () => {
  it('builds the expected DomainEvent shape', () => {
    const event = salaryStructureCreated('struct-1', 'org-1', 'emp-1', 1, new Date('2026-08-01'));

    expect(event.type).toBe('SalaryStructureCreated');
    expect(event.aggregateType).toBe('SalaryStructure');
    expect(event.aggregateId).toBe('struct-1');
    expect(event.payload).toEqual({
      organizationId: 'org-1',
      employeeId: 'emp-1',
      version: 1,
      effectiveFrom: '2026-08-01T00:00:00.000Z',
    });
  });
});

describe('salaryStructureVersionCreated', () => {
  it('builds the expected DomainEvent shape with previousVersion metadata, no line items', () => {
    const event = salaryStructureVersionCreated(
      'struct-2',
      'org-1',
      'emp-1',
      2,
      new Date('2026-08-01'),
      'struct-1',
      1,
    );

    expect(event.type).toBe('SalaryStructureVersionCreated');
    expect(event.aggregateId).toBe('struct-2');
    expect(event.payload).toEqual({
      organizationId: 'org-1',
      employeeId: 'emp-1',
      version: 2,
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      previousVersionId: 'struct-1',
      previousVersion: 1,
    });
  });
});
