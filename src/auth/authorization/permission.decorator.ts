// src/auth/authorization/permission.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';

export interface PermissionRequirement {
  permission: string;
  scope: 'own' | 'department' | 'organization';
}

export const RequirePermission = (
  permission: string,
  options: { scope: PermissionRequirement['scope'] },
) => SetMetadata(PERMISSION_KEY, { permission, scope: options.scope } as PermissionRequirement);
