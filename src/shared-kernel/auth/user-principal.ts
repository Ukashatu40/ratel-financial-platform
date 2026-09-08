// src/shared-kernel/auth/user-principal.ts
export interface RoleAssignment {
  role: string;
  departmentId: string | null;
}

export interface UserPrincipal {
  id: string;
  email: string;
  organizationId: string;
  roles: RoleAssignment[];
  // Phase 9.2 — set by AuthService.stepUp() (unix ms) when the caller
  // re-entered their password within the current session. Checked by
  // PermissionGuard for any `@RequirePermission(..., { requiresStepUp: true })`
  // route via shared-kernel/auth/step-up.ts. Absent on a plain login/refresh.
  stepUpAt?: number;
  // Reserved, unused slot for real MFA (Phase 9.2: "the auth module should
  // have an mfaVerifiedAt claim slot in the token payload from day one").
  // No MFA provider exists yet — never set by any code path today. Exists
  // so wiring a real MFA check in later is a guard-side change, not a
  // token-shape migration.
  mfaVerifiedAt?: number;
}
