// src/contexts/expense/domain/value-objects/expense-source.ts
export type ExpenseSourceType = 'manual' | 'employee' | 'accountant' | 'import' | 'integration';

export interface ExpenseSource {
  type: ExpenseSourceType;
  actorId: string;
  importJobId?: string;
}

export function humanSource(type: 'manual' | 'employee' | 'accountant', actorId: string): ExpenseSource {
  return { type, actorId };
}

export function importedSource(actorId: string, importJobId: string): ExpenseSource {
  // actorId here is the system/service-account identity that ran the import,
  // not a human — kept distinct so audit entries can tell the two apart (Phase 1.4/6.2)
  return { type: 'import', actorId, importJobId };
}