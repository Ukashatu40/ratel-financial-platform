// src/auth/authorization/prisma-effective-scope.resolver.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EffectiveScope,
  EffectiveScopeResolver,
} from '../../shared-kernel/auth/effective-scope-resolver.port';

@Injectable()
export class PrismaEffectiveScopeResolver implements EffectiveScopeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveWidestScope(roles: string[], permission: string): Promise<EffectiveScope> {
    if (roles.length === 0) return null;

    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { in: roles as any }, permission },
    });
    if (grants.length === 0) return null;

    if (grants.some((g) => g.scope === 'organization')) return 'organization';
    if (grants.some((g) => g.scope === 'department')) return 'department';
    if (grants.some((g) => g.scope === 'own')) return 'own';
    return null;
  }
}
