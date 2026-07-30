// src/shared-kernel/money/currency-code.ts
// Deliberately a closed union, not a free string — invalid currencies should be
// unrepresentable at the type level, matching the DB enum decision in Phase 6.3.
export const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}