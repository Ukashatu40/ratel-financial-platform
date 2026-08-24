// src/shared-kernel/money/money.vo.ts
import { CurrencyCode, isSupportedCurrency } from './currency-code';
import { DomainError } from '../errors/domain-error';

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

/**
 * Extends DomainError, per critical convention #5 — a client-supplied currency is
 * client input, so this is a 400. Reachable over HTTP: `CreateExpenseDto` validates
 * `@Length(3, 3)` but NOT that the code is one this system supports, so any
 * three-letter code Money doesn't know reaches `Money.of()` here. As a bare Error
 * that surfaced as a 500 saying "An unexpected error occurred", hiding the one
 * detail the caller needed. Fixed with TECH_DEBT #50.
 *
 * Safe to import DomainError here: `errors/domain-error.ts` imports nothing, so
 * there is no cycle with the shared kernel's Money.
 */
export class InvalidCurrencyError extends DomainError {
  readonly code = 'unsupported-currency';
  readonly httpStatus = 400;

  constructor(currency: string) {
    super(`Unsupported currency: ${currency}`);
  }
}

/**
 * Deliberately still a bare Error, and NOT the same case as InvalidCurrencyError
 * above — see TECH_DEBT #51. This is thrown by `assertSameCurrency()` during
 * arithmetic, i.e. when application code combines two Money values of different
 * currencies. That is a programmer error, not something a caller submitted, so a
 * 500 is arguably the honest status; converting it to a 400 would blame the client
 * for an internal bug. Left as a deliberate open question rather than silently
 * decided.
 */
export class CurrencyMismatchError extends DomainError {
  readonly code = 'currency-mismatch';
  readonly httpStatus = 500;

  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: cannot operate on ${a} and ${b} directly`);
  }
}
