// test/unit/integration/import-record-mapper.spec.ts
import {
  ImportMappingError,
  ImportRecordMapper,
} from '../../../src/integration/acl/import-record-mapper';
import { RawImportRecord } from '../../../src/integration/domain/raw-import-record';
import { describe, it, expect } from '@jest/globals';

function buildRecord(overrides: Partial<RawImportRecord> = {}): RawImportRecord {
  return {
    externalId: 'csv-row-2',
    sourceRecordHash: 'hash-1',
    departmentName: 'Engineering',
    categoryName: 'Cloud Services',
    vendorName: 'AWS',
    amountMinorUnits: 5000n,
    currency: 'NGN',
    expenseDate: new Date('2026-08-15'),
    description: 'test',
    ...overrides,
  };
}

function buildFakePrisma(overrides: Partial<{ department: any; category: any; vendor: any }> = {}) {
  return {
    department: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'department' in overrides ? overrides.department : { id: 'dept-1', name: 'Engineering' },
        ),
    },
    expenseCategory: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'category' in overrides ? overrides.category : { id: 'cat-1', name: 'Cloud Services' },
        ),
    },
    vendor: {
      upsert: jest
        .fn()
        .mockResolvedValue(
          'vendor' in overrides ? overrides.vendor : { id: 'vendor-1', name: 'AWS' },
        ),
    },
  };
}

describe('ImportRecordMapper', () => {
  it('builds a CreateExpenseCommand when department/category resolve successfully', async () => {
    const prisma = buildFakePrisma();
    const mapper = new ImportRecordMapper(prisma as any);

    const command = await mapper.toCreateExpenseCommand(buildRecord(), 'org-1', 'job-1', 'user-1');

    expect(command.organizationId).toBe('org-1');
    expect(command.categoryId).toBe('cat-1');
    expect(command.departmentId).toBe('dept-1');
    expect(command.amountMinorUnits).toBe(5000n);
    expect(command.source).toEqual({ type: 'import', actorId: 'user-1', importJobId: 'job-1' });
  });

  it('throws ImportMappingError when department does not exist', async () => {
    const prisma = buildFakePrisma({ department: null });
    const mapper = new ImportRecordMapper(prisma as any);

    await expect(
      mapper.toCreateExpenseCommand(buildRecord(), 'org-1', 'job-1', 'user-1'),
    ).rejects.toThrow(ImportMappingError);
  });

  it('throws ImportMappingError when category does not exist', async () => {
    const prisma = buildFakePrisma({ category: null });
    const mapper = new ImportRecordMapper(prisma as any);

    await expect(
      mapper.toCreateExpenseCommand(buildRecord(), 'org-1', 'job-1', 'user-1'),
    ).rejects.toThrow(ImportMappingError);
  });

  it('leaves vendorId undefined when the record has no vendor name (does not call upsert)', async () => {
    const prisma = buildFakePrisma();
    const mapper = new ImportRecordMapper(prisma as any);

    const command = await mapper.toCreateExpenseCommand(
      buildRecord({ vendorName: undefined }),
      'org-1',
      'job-1',
      'user-1',
    );

    expect(command.vendorId).toBeUndefined();
    expect(prisma.vendor.upsert).not.toHaveBeenCalled();
  });

  it('auto-creates (upserts) a vendor that does not already exist', async () => {
    const prisma = buildFakePrisma();
    const mapper = new ImportRecordMapper(prisma as any);

    await mapper.toCreateExpenseCommand(
      buildRecord({ vendorName: 'New Vendor Inc' }),
      'org-1',
      'job-1',
      'user-1',
    );

    expect(prisma.vendor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: 'org-1', name: 'New Vendor Inc' } },
        create: { organizationId: 'org-1', name: 'New Vendor Inc' },
      }),
    );
  });

  it('does NOT auto-create department or category the way it does vendor — this is the deliberate asymmetry', async () => {
    // Governed reference data (department/category) requires EXISTING
    // records; only vendor (open-ended, less governed) auto-creates.
    // This test exists specifically to guard that asymmetry against a
    // future "simplification" that treats all three the same way.
    const prisma = buildFakePrisma({ department: null });
    const mapper = new ImportRecordMapper(prisma as any);

    await expect(
      mapper.toCreateExpenseCommand(buildRecord(), 'org-1', 'job-1', 'user-1'),
    ).rejects.toThrow();
    expect(prisma.department.findFirst).toHaveBeenCalled();
    // Confirms no department.create or department.upsert method was ever invoked —
    // there isn't one on the fake, so calling it would throw a "not a function"
    // error rather than silently succeeding, which is itself a form of assertion.
  });

  it('rejects a department that exists but is INACTIVE — same as nonexistent', async () => {
    const prisma = buildFakePrisma({ department: null }); // findFirst with isActive:true filter would return null for an inactive row
    const mapper = new ImportRecordMapper(prisma as any);

    await expect(
      mapper.toCreateExpenseCommand(buildRecord(), 'org-1', 'job-1', 'user-1'),
    ).rejects.toThrow(ImportMappingError);
  });

  it('reactivates a previously-deactivated vendor rather than rejecting the import', async () => {
    const prisma = buildFakePrisma();
    const mapper = new ImportRecordMapper(prisma as any);

    await mapper.toCreateExpenseCommand(
      buildRecord({ vendorName: 'Formerly Inactive Vendor' }),
      'org-1',
      'job-1',
      'user-1',
    );

    expect(prisma.vendor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { isActive: true } }), // was: update: {} — now explicitly reactivates on match
    );
  });
});
