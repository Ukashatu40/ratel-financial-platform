// src/auth/authorization/permission.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface PermissionRequirement {
  permission: string;
  resourceType?: string; // only needed when a resource-level (own/department) check applies
}

export const RequirePermission = (permission: string, options?: { resourceType?: string }) =>
  SetMetadata(PERMISSION_KEY, {
    permission,
    resourceType: options?.resourceType,
  } as PermissionRequirement);
