// src/contexts/payroll/domain/value-objects/salary-line-item.ts
import { Money, MoneyJSON } from '../../../../shared-kernel/money/money.vo';

export type LineItemKind = 'allowance' | 'deduction' | 'loan_repayment';

export interface SalaryLineItem {
  kind: LineItemKind;
  label: string;
  amount: Money;
}

export interface SerializedSalaryLineItem {
  kind: LineItemKind;
  label: string;
  amount: MoneyJSON;
}

/**
 * These live alongside the VO itself (domain layer) rather than in
 * infrastructure, since they only depend on Money.toJSON()/fromJSON() —
 * both domain-safe. This is what lets the seed script (prisma/seed/, which
 * sits outside the Nest DI container but still legitimately imports domain
 * types) serialize line items using the EXACT same logic the repositories
 * use at runtime, per the "one source of truth" reasoning that drove the
 * pure-crypto-functions refactor.
 */
export function serializeLineItems(items: SalaryLineItem[]): SerializedSalaryLineItem[] {
  return items.map((item) => ({
    kind: item.kind,
    label: item.label,
    amount: item.amount.toJSON(),
  }));
}

export function deserializeLineItems(items: SerializedSalaryLineItem[]): SalaryLineItem[] {
  return items.map((item) => ({
    kind: item.kind,
    label: item.label,
    amount: Money.fromJSON(item.amount),
  }));
}
