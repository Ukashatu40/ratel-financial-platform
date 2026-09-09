// test/unit/config/cors.config.spec.ts
import { describe, expect, it } from '@jest/globals';
import { parseCorsOrigins, buildCorsOptions } from '../../../src/config/cors.config';

describe('parseCorsOrigins', () => {
  it('returns false when unset — CORS disabled, the safe default', () => {
    expect(parseCorsOrigins(undefined)).toBe(false);
  });

  it('returns false for an empty or whitespace-only string', () => {
    expect(parseCorsOrigins('')).toBe(false);
    expect(parseCorsOrigins('   ')).toBe(false);
  });

  it('returns true for the literal wildcard "*"', () => {
    expect(parseCorsOrigins('*')).toBe(true);
  });

  it('returns true if "*" appears anywhere in a comma-separated list', () => {
    expect(parseCorsOrigins('https://a.com,*,https://b.com')).toBe(true);
  });

  it('returns a single-origin array for one origin', () => {
    expect(parseCorsOrigins('https://app.ratel-plus.com')).toEqual([
      'https://app.ratel-plus.com',
    ]);
  });

  it('splits, trims, and returns multiple origins as an array', () => {
    expect(parseCorsOrigins('https://a.com, https://b.com ,https://c.com')).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('drops empty entries from a trailing/duplicate comma', () => {
    expect(parseCorsOrigins('https://a.com,,https://b.com,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('buildCorsOptions', () => {
  it('combines the parsed origin with the credentials flag as-is', () => {
    expect(buildCorsOptions('https://a.com', true)).toEqual({
      origin: ['https://a.com'],
      credentials: true,
    });
    expect(buildCorsOptions(undefined, false)).toEqual({
      origin: false,
      credentials: false,
    });
  });
});
