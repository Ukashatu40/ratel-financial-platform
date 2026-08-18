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
}
