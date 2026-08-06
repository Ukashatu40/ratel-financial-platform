// src/auth/authorization/permission.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_KEY, PermissionRequirement } from './permission.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import { ResourceScopeRegistry } from '../../shared-kernel/auth/resource-scope-registry';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly scopeRegistry: ResourceScopeRegistry,
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

    const userRoles = user.roles.map((r) => r.role);
    if (userRoles.length === 0) return false;

    // Every role assignment the user holds that grants this permission,
    // AT WHATEVER SCOPE the role_permissions table actually says — this is
    // now the single source of truth, not a decorator argument that could
    // silently drift from what's actually seeded.
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { in: userRoles as any }, permission: requirement.permission },
    });
    if (grants.length === 0) return false;

    // An organization-scoped grant is sufficient on its own — no resource
    // lookup needed. This is also why Payroll never needs a
    // ResourceScopeProvider: every payroll permission is org-scoped only.
    if (grants.some((g) => g.scope === 'organization')) return true;

    // No resourceType means there's no existing resource to check against
    // (e.g. a CREATE action) — holding the permission at all is sufficient.
    if (!requirement.resourceType) return true;

    const resourceId = request.params?.id;
    if (!resourceId) return true;

    const scopeInfo = await this.scopeRegistry.resolve(requirement.resourceType, resourceId);
    if (!scopeInfo) {
      // 404, not 403 — the resource genuinely doesn't exist, so there's
      // nothing to be "forbidden" from. Using 403 here would have leaked
      // information in the wrong direction: it implies "this exists but
      // you can't see it," which is worse than just saying "not found,"
      // the same way EntityNotFoundError already behaves for org-mismatch
      // cases elsewhere in the codebase.
      throw new NotFoundException(`Resource not found`);
    }

    const hasOwnGrant = grants.some((g) => g.scope === 'own');
    if (hasOwnGrant && scopeInfo.requesterId === user.id) return true;

    const hasDepartmentGrant = grants.some((g) => g.scope === 'department');
    if (
      hasDepartmentGrant &&
      scopeInfo.departmentId &&
      user.roles.some((r) => r.departmentId === scopeInfo.departmentId)
    ) {
      return true;
    }

    return false;
  }
}
