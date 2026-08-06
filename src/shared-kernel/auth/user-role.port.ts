// src/shared-kernel/auth/user-role.port.ts
export interface RoleAssignment {
  role: string;
  departmentId: string | null;
}

export interface UserRoleService {
  getRolesForUser(userId: string): Promise<RoleAssignment[]>;
}

export const USER_ROLE_SERVICE = Symbol('USER_ROLE_SERVICE');
