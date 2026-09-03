// src/auth/authorization/prisma-user-role.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleAssignment, UserRoleService } from '../../shared-kernel/auth/user-role.port';

@Injectable()
export class PrismaUserRoleService implements UserRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async getRolesForUser(userId: string): Promise<RoleAssignment[]> {
    const [departmentRows, organizationRows] = await Promise.all([
      this.prisma.departmentRoleAssignment.findMany({ where: { userId } }),
      this.prisma.organizationRoleAssignment.findMany({ where: { userId } }),
    ]);

    return [
      ...departmentRows.map((r) => ({
        role: r.role as string,
        departmentId: r.departmentId as string | null,
        organizationId: r.organizationId,
      })),
      ...organizationRows.map((r) => ({
        role: r.role as string,
        departmentId: null as string | null,
        organizationId: r.organizationId,
      })),
    ];
  }
}
