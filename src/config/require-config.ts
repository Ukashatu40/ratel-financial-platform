// src/config/require-config.ts
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './env.schema';

/**
 * Reads a config value that Zod's validateEnv() (main.ts) already
 * guarantees exists at runtime — validation happens before Nest even
 * finishes bootstrapping, so by the time any service constructor runs,
 * every required env var is confirmed present. ConfigService's generic
 * typing can't express that guarantee statically (it types every key as
 * possibly undefined, since it has no visibility into our Zod schema's
 * `.min()`/required rules), so this helper closes that gap in ONE place
 * rather than scattering non-null assertions across every call site that
 * needs a required env var (JWT secrets, encryption key, etc.).
 *
 * Only use this for keys that are genuinely required in env.schema.ts
 * (no .optional() / no .default() masking a missing value) — using it on
 * an actually-optional key would just convert a real "value might be
 * missing" case into a runtime crash with a confusing message.
 */
export function requireConfig<K extends keyof EnvConfig>(
  config: ConfigService<EnvConfig>,
  key: K,
): NonNullable<EnvConfig[K]> {
  const value = config.get(key, { infer: true });
  if (value === undefined || value === null) {
    throw new Error(
      `Required config key "${String(key)}" was undefined at runtime — this should be impossible if validateEnv() ran correctly in main.ts. Check env.schema.ts and .env.`,
    );
  }
  return value as NonNullable<EnvConfig[K]>;
}
