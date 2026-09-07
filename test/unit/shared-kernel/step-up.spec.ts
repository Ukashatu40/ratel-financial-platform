// test/unit/shared-kernel/step-up.spec.ts
import { describe, expect, it } from '@jest/globals';
import { isStepUpFresh, STEP_UP_DEFAULTS } from '../../../src/shared-kernel/auth/step-up';

describe('isStepUpFresh', () => {
  const windowMs = STEP_UP_DEFAULTS.WINDOW_MS;
  const now = 1_000_000_000_000; // fixed epoch ms, not wall-clock — see the `now` param

  it('is not fresh when stepUpAt is undefined — a plain login/refresh token', () => {
    expect(isStepUpFresh(undefined, windowMs, now)).toBe(false);
  });

  it('is fresh exactly at the step-up moment', () => {
    expect(isStepUpFresh(now, windowMs, now)).toBe(true);
  });

  it('is fresh at the exact boundary of the window (inclusive)', () => {
    expect(isStepUpFresh(now - windowMs, windowMs, now)).toBe(true);
  });

  it('is stale one millisecond past the window', () => {
    expect(isStepUpFresh(now - windowMs - 1, windowMs, now)).toBe(false);
  });

  it('is stale for a step-up long in the past', () => {
    expect(isStepUpFresh(now - windowMs * 100, windowMs, now)).toBe(false);
  });

  it('treats a stepUpAt in the future as fresh — clock skew tolerance is not this function\'s concern', () => {
    // A negative "age" (now - stepUpAt < 0) is still <= windowMs, so this
    // passes. Pinned deliberately: if clock-skew rejection is ever wanted,
    // it's a conscious addition here, not an accidental side effect of
    // reading this comparison differently.
    expect(isStepUpFresh(now + 5_000, windowMs, now)).toBe(true);
  });
});
