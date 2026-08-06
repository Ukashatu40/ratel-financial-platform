// src/auth/authorization/prisma-user-role.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleAssignment, UserRoleService } from '../../shared-kernel/auth/user-role.port';

@Injectable()
export class PrismaUserRoleService implements UserRoleService {
  constructor(private readonly prisma: PrismaService) {}

  async getRolesForUser(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.prisma.userRoleAssignment.findMany({ where: { userId } });
    return rows.map((r) => ({ role: r.role, departmentId: r.departmentId }));
  }
}
