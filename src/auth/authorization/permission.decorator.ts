// src/auth/authorization/permission.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface PermissionRequirement {
  permission: string;
  resourceType?: string; // only needed when a resource-level (own/department) check applies
  // Phase 9.2 — require a recent password re-entry (AuthService.stepUp())
  // in addition to the permission/scope check, for the most sensitive
  // actions (payroll:view_sensitive, period:close). Checked by
  // PermissionGuard only after the normal grant/scope check already
  // passed, so a caller who lacks the permission entirely still gets the
  // existing "missing permission" message, not a step-up prompt for
  // something they couldn't do anyway.
  requiresStepUp?: boolean;
}

export const RequirePermission = (
  permission: string,
  options?: { resourceType?: string; requiresStepUp?: boolean },
) =>
  SetMetadata(PERMISSION_KEY, {
    permission,
    resourceType: options?.resourceType,
    requiresStepUp: options?.requiresStepUp,
  } as PermissionRequirement);
