// src/auth/authorization/permission.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_KEY, PermissionRequirement } from './permission.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import { ResourceScopeRegistry } from '../../shared-kernel/auth/resource-scope-registry';
import { EntityNotFoundError } from '../../shared-kernel/errors/domain-error';
import { isStepUpFresh, STEP_UP_DEFAULTS } from '../../shared-kernel/auth/step-up';
import { EnvConfig } from '../../config/env.schema';
import { RoleName } from '@prisma/client';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly scopeRegistry: ResourceScopeRegistry,
    private readonly config: ConfigService<EnvConfig>,
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
    if (userRoles.length === 0) {
      throw new ForbiddenException('You have no assigned roles, so you cannot perform this action');
    }

    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { in: userRoles as RoleName[] }, permission: requirement.permission },
    });

    if (grants.length === 0) {
      throw new ForbiddenException(
        `None of your roles (${userRoles.join(', ')}) grant the '${requirement.permission}' permission`,
      );
    }

    if (grants.some((g) => g.scope === 'organization')) return this.allow(requirement, user);
    if (!requirement.resourceType) return this.allow(requirement, user);

    const resourceId = request.params?.id;
    if (!resourceId) return this.allow(requirement, user);

    const scopeInfo = await this.scopeRegistry.resolve(requirement.resourceType, resourceId);
    if (!scopeInfo) {
      throw new EntityNotFoundError(requirement.resourceType, resourceId);
    }

    const hasOwnGrant = grants.some((g) => g.scope === 'own');
    if (hasOwnGrant && scopeInfo.requesterId === user.id) return this.allow(requirement, user);

    const hasDepartmentGrant = grants.some((g) => g.scope === 'department');
    if (
      hasDepartmentGrant &&
      scopeInfo.departmentId &&
      user.roles.some((r) => r.departmentId === scopeInfo.departmentId)
    ) {
      return this.allow(requirement, user);
    }

    // The user HAS a grant for this permission, but only at a scope
    // (own/department) that doesn't cover THIS specific resource — say so
    // specifically, rather than falling through to a generic denial.
    const action = requirement.permission.split(':')[1] ?? 'access';
    if (hasOwnGrant) {
      throw new ForbiddenException(`You can only ${action} resources you created yourself`);
    }
    if (hasDepartmentGrant) {
      throw new ForbiddenException(`You can only ${action} resources within your own department`);
    }

    throw new ForbiddenException('You do not have sufficient permission scope for this action');
  }

  /**
   * Called only once the permission/scope check has ALREADY passed —
   * checked last and separately, per Phase 9.2, so a caller who lacks the
   * permission entirely still gets the existing "missing permission"
   * message rather than being told to step up for something they
   * couldn't do anyway.
   */
  private allow(requirement: PermissionRequirement, user: UserPrincipal): true {
    if (requirement.requiresStepUp) {
      const windowMs =
        this.config.get('STEP_UP_WINDOW_MS', { infer: true }) ?? STEP_UP_DEFAULTS.WINDOW_MS;
      if (!isStepUpFresh(user.stepUpAt, windowMs)) {
        throw new ForbiddenException(
          `This action requires a recent step-up re-authentication — POST /auth/step-up with your ` +
            `password, then retry within ${Math.round(windowMs / 60_000)} minutes`,
        );
      }
    }
    return true;
  }
}
