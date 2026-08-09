// src/shared-kernel/errors/error-chain.util.ts
/**
 * Walks an Error's .cause chain (which Prisma 7's driver-adapter errors use
 * to nest the real underlying failure, at inconsistent depths depending on
 * error type — confirmed empirically: a "database starting up" error and a
 * "stale pooled connection" error wrap their real detail at DIFFERENT
 * depths). Collects every unique message found along the way, rather than
 * assuming any fixed nesting depth.
 */
export function collectErrorChainMessages(error: unknown, maxDepth = 6): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  let depth = 0;

  while (current instanceof Error && depth < maxDepth) {
    const trimmed = current.message?.trim();
    if (trimmed && !messages.includes(trimmed)) {
      messages.push(trimmed);
    }
    current = (current as Error & { cause?: unknown }).cause;
    depth++;
  }

  return messages;
}
