// src/shared-kernel/pagination/cursor.ts
export interface Cursor {
  createdAt: string; // ISO string
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(encoded: string): Cursor {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new RangeError('Invalid cursor');
  }
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
