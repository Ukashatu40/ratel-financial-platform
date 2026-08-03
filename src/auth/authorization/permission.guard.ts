// src/auth/authorization/permission.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_KEY, PermissionRequirement } from './permission.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.get<PermissionRequirement>(
      PERMISSION_KEY,
      context.getHandler(),
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest();
    const user: UserPrincipal | undefined = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const bodyOrgId = request.body?.organizationId;
    if (bodyOrgId && bodyOrgId !== user.organizationId) {
      throw new ForbiddenException('organizationId does not match authenticated user');
    }

    const userRoles = user.roles.map((r) => r.role);
    if (userRoles.length === 0) return false;

    const grant = await this.prisma.rolePermission.findFirst({
      where: { role: { in: userRoles as any }, permission: requirement.permission },
    });

    return grant !== null;
  }
}
