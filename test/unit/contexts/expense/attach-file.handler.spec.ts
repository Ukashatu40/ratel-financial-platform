// test/unit/contexts/expense/attach-file.handler.spec.ts
import {
  AttachFileHandler,
  FileTooLargeError,
  UnsupportedFileTypeError,
} from '../../../../src/contexts/expense/application/handlers/attach-file.handler';
import { AttachFileCommand } from '../../../../src/contexts/expense/application/commands/attach-file.command';
import { EntityNotFoundError } from '../../../../src/shared-kernel/errors/domain-error';
import { Expense } from '../../../../src/contexts/expense/domain/aggregates/expense.aggregate';
import { Money } from '../../../../src/shared-kernel/money/money.vo';
import { humanSource } from '../../../../src/contexts/expense/domain/value-objects/expense-source';
import { describe, expect, it } from '@jest/globals';

function buildExpense(organizationId = 'org-1') {
  return Expense.create({
    organizationId,
    expenseNumber: 'EXP-000001',
    source: humanSource('employee', 'user-1'),
    amount: Money.of(50000n, 'NGN'),
    categoryId: 'cat-1',
    departmentId: 'dept-1',
    periodId: 'period-1',
    expenseDate: new Date('2026-08-01'),
  });
}

function buildDeps(overrides: { expense?: Expense | null } = {}) {
  const expense = overrides.expense !== undefined ? overrides.expense : buildExpense();
  return {
    expenseRepo: { findById: jest.fn().mockResolvedValue(expense) },
    storage: { upload: jest.fn().mockResolvedValue(undefined) },
    prisma: { attachment: { create: jest.fn().mockResolvedValue({}) } },
  };
}

describe('AttachFileHandler', () => {
  it('rejects an unsupported content type before touching storage or the DB', async () => {
    const deps = buildDeps();
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'malware.exe',
      'application/x-msdownload',
      Buffer.from('x'),
    );

    await expect(handler.execute(cmd)).rejects.toThrow(UnsupportedFileTypeError);
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit before touching storage', async () => {
    const deps = buildDeps();
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const oversized = Buffer.alloc(11 * 1024 * 1024); // 11MB > 10MB limit
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'huge.pdf',
      'application/pdf',
      oversized,
    );

    await expect(handler.execute(cmd)).rejects.toThrow(FileTooLargeError);
    expect(deps.storage.upload).not.toHaveBeenCalled();
  });

  it('throws EntityNotFoundError when the expense does not exist', async () => {
    const deps = buildDeps({ expense: null });
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'missing',
      'org-1',
      'user-1',
      'r.pdf',
      'application/pdf',
      Buffer.from('x'),
    );

    await expect(handler.execute(cmd)).rejects.toThrow(EntityNotFoundError);
  });

  it('throws EntityNotFoundError when the expense belongs to a different organization', async () => {
    const deps = buildDeps({ expense: buildExpense('org-OTHER') });
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'r.pdf',
      'application/pdf',
      Buffer.from('x'),
    );

    await expect(handler.execute(cmd)).rejects.toThrow(EntityNotFoundError);
  });

  it('uploads to storage BEFORE persisting the DB row — never creates a metadata row for a failed upload', async () => {
    const deps = buildDeps();
    deps.storage.upload = jest.fn().mockRejectedValue(new Error('S3 down'));
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'r.pdf',
      'application/pdf',
      Buffer.from('x'),
    );

    await expect(handler.execute(cmd)).rejects.toThrow('S3 down');
    expect(deps.prisma.attachment.create).not.toHaveBeenCalled(); // the ordering guarantee this test exists to protect
  });

  it('always persists scanStatus as "unscanned" — never a misleading default', async () => {
    const deps = buildDeps();
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'r.pdf',
      'application/pdf',
      Buffer.from('x'),
    );

    await handler.execute(cmd);

    expect(deps.prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scanStatus: 'unscanned' }) }),
    );
  });

  it('builds a storage key that includes organizationId and expenseId (namespacing, not just a flat filename)', async () => {
    const deps = buildDeps();
    const handler = new AttachFileHandler(
      deps.expenseRepo as any,
      deps.storage as any,
      deps.prisma as any,
    );
    const cmd = new AttachFileCommand(
      'exp-1',
      'org-1',
      'user-1',
      'r.pdf',
      'application/pdf',
      Buffer.from('x'),
    );

    await handler.execute(cmd);

    const uploadedKey = deps.storage.upload.mock.calls[0][0];
    expect(uploadedKey).toContain('org-1');
    expect(uploadedKey).toContain('exp-1');
  });
});
