// src/auth/authorization/permission.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { EntityNotFoundError } from '../../shared-kernel/errors/domain-error';
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
      // Reusing the SAME DomainError subclass GetExpenseByIdHandler throws
      // for the org-mismatch case — this is what actually makes the two
      // code paths (guard-level "doesn't exist" vs handler-level "wrong
      // org") produce IDENTICAL type/detail shapes, not just matching
      // status codes. requirement.resourceType ('expense', 'payrollRun')
      // doubles as the entityType here, which is why this reuses cleanly.
      throw new EntityNotFoundError(requirement.resourceType, resourceId);
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
