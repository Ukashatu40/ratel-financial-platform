// src/shared-kernel/money/money.vo.ts
import { CurrencyCode, isSupportedCurrency } from './currency-code';

export interface MoneyJSON {
  minorUnits: string; // bigint as string — JSON has no native bigint
  currency: CurrencyCode;
}

/**
 * Money value object. Amount is ALWAYS stored in minor units (kobo, cents)
 * as a bigint — never a float. This is a direct, deliberate reuse of the
 * lesson from the payflow-orchestration BIGINT-paise decision and the
 * BED-6C directional-balance bug: financial amounts must never touch
 * floating point arithmetic anywhere in the domain layer.
 */
export class Money {
  private constructor(
    private readonly amountMinorUnits: bigint,
    private readonly currency: CurrencyCode,
  ) {}

  static of(amountMinorUnits: bigint | number, currency: string): Money {
    if (!isSupportedCurrency(currency)) {
      throw new InvalidCurrencyError(currency);
    }
    const amount =
      typeof amountMinorUnits === 'number'
        ? BigInt(Math.trunc(amountMinorUnits))
        : amountMinorUnits;

    return new Money(amount, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  get minorUnits(): bigint {
    return this.amountMinorUnits;
  }

  get currencyCode(): CurrencyCode {
    return this.currency;
  }

  isZero(): boolean {
    return this.amountMinorUnits === 0n;
  }

  isNegative(): boolean {
    return this.amountMinorUnits < 0n;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinorUnits + other.amountMinorUnits, this.currency);
  }

  negate(): Money {
    // Used specifically for constructing adjustment/reversal entries (Phase 2.3)
    return new Money(-this.amountMinorUnits, this.currency);
  }

  equals(other: Money): boolean {
    return this.amountMinorUnits === other.amountMinorUnits && this.currency === other.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  toJSON(): MoneyJSON {
    return { minorUnits: this.amountMinorUnits.toString(), currency: this.currency };
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.of(BigInt(json.minorUnits), json.currency);
  }
}

export class InvalidCurrencyError extends Error {
  constructor(currency: string) {
    super(`Unsupported currency: ${currency}`);
    this.name = 'InvalidCurrencyError';
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: cannot operate on ${a} and ${b} directly`);
    this.name = 'CurrencyMismatchError';
  }
}
