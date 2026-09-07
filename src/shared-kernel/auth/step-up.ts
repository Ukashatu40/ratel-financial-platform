// src/shared-kernel/auth/step-up.ts
//
// Phase 9.2 — step-up re-authentication for the most sensitive actions
// (`payroll:view_sensitive`, `period:close`), independent of whether real
// MFA is ever enabled: re-entering the current password within the last
// N minutes, checked via a claim on the access token rather than
// server-side session state, consistent with this app's stateless-JWT
// design (Phase 9.2's "JWT-based, stateless").
export const STEP_UP_DEFAULTS = {
  WINDOW_MS: 10 * 60 * 1000, // 10 minutes
} as const;

/**
 * Pure so it's trivially unit-testable without a clock mock framework —
 * takes "now" as a parameter instead of reading `Date.now()` itself.
 */
export function isStepUpFresh(
  stepUpAt: number | undefined,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  if (stepUpAt === undefined) return false;
  return now - stepUpAt <= windowMs;
}
