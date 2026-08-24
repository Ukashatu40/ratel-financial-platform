// test/unit/shared-kernel/money.spec.ts
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  Money,
} from '../../../src/shared-kernel/money/money.vo';
import { DomainError } from '../../../src/shared-kernel/errors/domain-error';
import { describe, expect, it } from '@jest/globals';

describe('Money', () => {
  describe('of()', () => {
    it('creates a Money instance from a bigint amount', () => {
      const money = Money.of(150000n, 'NGN');
      expect(money.minorUnits).toBe(150000n);
      expect(money.currencyCode).toBe('NGN');
    });

    it('creates a Money instance from a number amount, truncating decimals', () => {
      const money = Money.of(150000.9, 'NGN');
      expect(money.minorUnits).toBe(150000n);
    });

    it('rejects an unsupported currency', () => {
      expect(() => Money.of(1000n, 'XYZ')).toThrow(InvalidCurrencyError);
    });
  });

  describe('zero()', () => {
    it('creates a zero-value Money in the given currency', () => {
      const money = Money.zero('NGN');
      expect(money.isZero()).toBe(true);
      expect(money.minorUnits).toBe(0n);
    });
  });

  describe('add()', () => {
    it('adds two Money values of the same currency', () => {
      const result = Money.of(1000n, 'NGN').add(Money.of(500n, 'NGN'));
      expect(result.minorUnits).toBe(1500n);
    });

    it('throws CurrencyMismatchError when adding different currencies', () => {
      expect(() => Money.of(1000n, 'NGN').add(Money.of(500n, 'USD'))).toThrow(
        CurrencyMismatchError,
      );
    });
  });

  describe('negate()', () => {
    it('flips the sign while preserving currency', () => {
      const negated = Money.of(1000n, 'NGN').negate();
      expect(negated.minorUnits).toBe(-1000n);
      expect(negated.currencyCode).toBe('NGN');
    });

    it('negate() twice returns to the original value', () => {
      const original = Money.of(1000n, 'NGN');
      expect(original.negate().negate().minorUnits).toBe(original.minorUnits);
    });
  });

  describe('isNegative() / isZero()', () => {
    it.each([
      [1000n, false, false],
      [0n, false, true],
      [-1000n, true, false],
    ])('for %i minor units: isNegative=%s, isZero=%s', (amount, expectedNegative, expectedZero) => {
      const money = Money.of(amount, 'NGN');
      expect(money.isNegative()).toBe(expectedNegative);
      expect(money.isZero()).toBe(expectedZero);
    });
  });

  describe('equals()', () => {
    it('returns true for equal amount and currency', () => {
      expect(Money.of(1000n, 'NGN').equals(Money.of(1000n, 'NGN'))).toBe(true);
    });

    it('returns false for different amounts', () => {
      expect(Money.of(1000n, 'NGN').equals(Money.of(1001n, 'NGN'))).toBe(false);
    });

    it('returns false for same amount, different currency', () => {
      expect(Money.of(1000n, 'NGN').equals(Money.of(1000n, 'USD'))).toBe(false);
    });
  });

  describe('toJSON() / fromJSON() round-trip', () => {
    it('preserves value and currency through serialization', () => {
      const original = Money.of(123456789n, 'USD');
      const restored = Money.fromJSON(original.toJSON());
      expect(restored.equals(original)).toBe(true);
    });

    it('preserves negative values through serialization', () => {
      const original = Money.of(-500000n, 'NGN');
      const restored = Money.fromJSON(original.toJSON());
      expect(restored.equals(original)).toBe(true);
    });
  });

  describe('CurrencyMismatchError (#51)', () => {
    it('throws a DomainError, not a bare Error, when adding mismatched currencies', () => {
      const ngn = Money.of(1000n, 'NGN');
      const usd = Money.of(1000n, 'USD');

      let caught: unknown;
      try {
        ngn.add(usd);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(DomainError);
      expect(caught).toBeInstanceOf(CurrencyMismatchError);
    });

    it('carries the correct code and status for ProblemDetailsFilter to render', () => {
      const ngn = Money.of(1000n, 'NGN');
      const usd = Money.of(1000n, 'USD');

      try {
        ngn.add(usd);
        fail('expected CurrencyMismatchError to be thrown');
      } catch (err) {
        const domainErr = err as CurrencyMismatchError;
        expect(domainErr.code).toBe('currency-mismatch');
        expect(domainErr.httpStatus).toBe(500);
        expect(domainErr.message).toBe('Currency mismatch: cannot operate on NGN and USD directly');
      }
    });

    it('does NOT throw when currencies match', () => {
      const a = Money.of(1000n, 'NGN');
      const b = Money.of(500n, 'NGN');
      expect(() => a.add(b)).not.toThrow();
    });
  });
});
