// src/config/env.schema.ts
import { z } from 'zod';
import { RATE_LIMIT_DEFAULTS } from '../rate-limit/rate-limit.constants';
import { IDEMPOTENCY_DEFAULTS } from '../idempotency/idempotency.constants';
import { STEP_UP_DEFAULTS } from '../shared-kernel/auth/step-up';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z
    .string()
    .regex(
      /^\d+(\s?(ms|s|m|h|d|w|y))?$/i,
      'JWT_ACCESS_TTL must be a valid duration like "15m", "1h", "7d"',
    )
    .default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  JWT_REFRESH_TTL: z.string().default('7d'),

  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().optional(),

  KMS_MASTER_KEY_ID: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  // Base64-encoded 32-byte key. In production this MUST come from a secret
  // store / KMS-derived value, never checked into source — placeholder
  // local key for dev only (Phase 9.3/9.4). Real KMS integration replaces
  // FIELD_ENCRYPTION_MASTER_KEY entirely; nothing outside AesGcmEnvelopeEncryptionService changes when that happens.
  FIELD_ENCRYPTION_MASTER_KEY: z
    .string()
    .min(44, 'FIELD_ENCRYPTION_MASTER_KEY must be a base64-encoded 32-byte key'),

  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  OTEL_METRICS_PORT: z.coerce.number().int().positive().default(9464),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default('noreply@ratel-plus.com'),

  // Phase 9.6 — per-IP token-bucket rate limiting (rate-limit.module.ts).
  // Stricter defaults on auth (credential-stuffing) and reports/export
  // (bulk-exfiltration) than the general baseline every other endpoint
  // gets. Defaults live in rate-limit.constants.ts, not restated here.
  RATE_LIMIT_DEFAULT_LIMIT: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.DEFAULT_LIMIT),
  RATE_LIMIT_DEFAULT_TTL_MS: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.DEFAULT_TTL_MS),
  RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.AUTH_LIMIT),
  RATE_LIMIT_AUTH_TTL_MS: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.AUTH_TTL_MS),
  RATE_LIMIT_REPORTS_LIMIT: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.REPORTS_LIMIT),
  RATE_LIMIT_REPORTS_TTL_MS: z.coerce.number().int().positive().default(RATE_LIMIT_DEFAULTS.REPORTS_TTL_MS),

  // Phase 7.5 — Idempotency-Key support (idempotency.module.ts).
  IDEMPOTENCY_RESPONSE_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(IDEMPOTENCY_DEFAULTS.RESPONSE_TTL_MS),
  IDEMPOTENCY_LOCK_TTL_MS: z.coerce.number().int().positive().default(IDEMPOTENCY_DEFAULTS.LOCK_TTL_MS),

  // Phase 9.2 — step-up re-authentication window (shared-kernel/auth/step-up.ts).
  STEP_UP_WINDOW_MS: z.coerce.number().int().positive().default(STEP_UP_DEFAULTS.WINDOW_MS),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Fail fast, at boot — never start with a malformed/missing config (Phase 4.4)
    console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}
