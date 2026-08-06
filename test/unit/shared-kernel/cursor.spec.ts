// test/unit/shared-kernel/cursor.spec.ts
import { decodeCursor, encodeCursor } from '../../../src/shared-kernel/pagination/cursor';
import { describe, expect, it } from '@jest/globals';

describe('cursor encode/decode', () => {
  it('round-trips a cursor through encode and decode', () => {
    const original = { createdAt: '2026-08-01T12:00:00.000Z', id: 'abc-123' };
    const decoded = decodeCursor(encodeCursor(original));
    expect(decoded).toEqual(original);
  });

  it('produces a URL-safe string (no +, /, or = characters)', () => {
    const encoded = encodeCursor({
      createdAt: '2026-08-01T12:00:00.000Z',
      id: 'has/special+chars==',
    });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('throws a RangeError on malformed input', () => {
    expect(() => decodeCursor('not-valid-base64-json!!!')).toThrow(RangeError);
  });
});
