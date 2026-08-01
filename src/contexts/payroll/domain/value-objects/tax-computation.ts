// src/contexts/payroll/domain/value-objects/tax-computation.ts
import { Money, MoneyJSON } from '../../../../shared-kernel/money/money.vo';

export interface TaxComputation {
  strategy: string;
  computedTax: Money;
  breakdown: Record<string, unknown>;
}

export interface SerializedTaxComputation {
  strategy: string;
  computedTax: MoneyJSON;
  breakdown: Record<string, unknown>;
}

export function noOpTaxComputation(currency: string): TaxComputation {
  return { strategy: 'noop', computedTax: Money.of(0n, currency), breakdown: {} };
}

export function serializeTaxComputation(tc: TaxComputation): SerializedTaxComputation {
  return { strategy: tc.strategy, computedTax: tc.computedTax.toJSON(), breakdown: tc.breakdown };
}

export function deserializeTaxComputation(tc: SerializedTaxComputation): TaxComputation {
  return {
    strategy: tc.strategy,
    computedTax: Money.fromJSON(tc.computedTax),
    breakdown: tc.breakdown,
  };
}
