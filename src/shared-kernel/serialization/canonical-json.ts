// src/shared-kernel/serialization/canonical-json.ts

/**
 * JSON-safe projection and canonical (recursively key-sorted) stringification.
 *
 * Two callers need this, for the same underlying reason: a value that will be
 * round-tripped through a Postgres `jsonb` column cannot be compared or hashed with
 * a plain `JSON.stringify`.
 *
 * `jsonb` does NOT preserve key insertion order — it stores a parsed, normalized
 * representation and returns keys in its own order. So `JSON.stringify(rowFromDb)`
 * and `JSON.stringify(originalObject)` can differ while representing exactly the
 * same data. Anything that hashes a jsonb payload and expects to recompute that hash
 * later from the stored row MUST sort keys on both sides, or every historical row
 * eventually looks tampered with.
 *
 * Used by:
 * - `AggregateRoot`'s state diff, to decide whether a field actually changed
 * - `computeEntryHashV2`, so the audit chain covers `oldValue`/`newValue`/`reason`
 *   in a way a future verifier can reproduce from the database
 *
 * KNOWN RESIDUAL RISK: `jsonb` also normalizes numbers (`1.0` is stored and returned
 * as `1`) and drops duplicate keys. Key ordering is handled here; numeric
 * normalization is not, and cannot be from this side. It is low-risk for this
 * codebase because audit payloads carry strings, booleans and null — `Money`
 * serializes `minorUnits` as a STRING precisely so bigint amounts never become
 * floats — but it is not impossible. Tracked in TECH_DEBT.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Projects any value into something `JSON.stringify` handles losslessly.
 *
 * `bigint` becomes a string rather than a number: `JSON.stringify` throws on bigint,
 * and `Number(bigint)` would silently lose precision on money amounts — the exact
 * failure class critical convention #1 exists to prevent.
 */
export function toJsonSafe(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value as JsonValue;
  // Non-finite numbers have no JSON representation; JSON.stringify emits null anyway,
  // so do it explicitly rather than relying on that.
  if (type === 'number') return Number.isFinite(value) ? (value as number) : null;
  if (type === 'bigint') return (value as bigint).toString();

  // Before the generic object branch: Date's own toJSON would also produce an ISO
  // string, but being explicit keeps the intent readable.
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(toJsonSafe);

  if (type === 'object') {
    // Value objects (Money, and any VO following its lead) expose toJSON(). Prefer it
    // over enumerating own properties, which for Money would leak the private
    // `amountMinorUnits` bigint field name instead of its intended shape.
    const candidate = value as { toJSON?: () => unknown };
    if (typeof candidate.toJSON === 'function') return toJsonSafe(candidate.toJSON());

    const result: { [key: string]: JsonValue } = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toJsonSafe(nested);
    }
    return result;
  }

  // functions, symbols — not representable, and never expected in aggregate state.
  return null;
}

/** Deterministic string for a value: JSON-safe, with every object's keys sorted. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(toJsonSafe(value)));
}

function sortKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysDeep);

  // Arrays are objects too, so this must come after the Array check. Array ORDER is
  // meaningful data and is deliberately preserved — only object keys get sorted.
  if (value !== null && typeof value === 'object') {
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = sortKeysDeep(value[key]);
    }
    return result;
  }

  return value;
}
