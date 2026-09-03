// src/shared-kernel/auth/user-role.port.ts
export interface RoleAssignment {
  role: string;
  departmentId: string | null;
  organizationId: string; // NEW — TECH_DEBT #14, consolidates AuthService and
  // NotificationProcessor onto this one seam instead
  // of each independently reimplementing "merge two
  // tables, take the first/any result"
}

export interface UserRoleService {
  getRolesForUser(userId: string): Promise<RoleAssignment[]>;
}

export const USER_ROLE_SERVICE = Symbol('USER_ROLE_SERVICE');
