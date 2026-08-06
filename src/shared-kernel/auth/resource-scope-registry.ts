// src/shared-kernel/auth/resource-scope-registry.ts
import { Injectable, Logger } from '@nestjs/common';
import { ResourceScopeInfo, ResourceScopeProvider } from './resource-scope-provider.port';

/**
 * Avoids the NestJS multi-provider problem (no built-in support for
 * multiple modules contributing to the same array-typed DI token) by using
 * the same self-registration pattern already proven with
 * DomainEventDispatcher.registerGlobal() / AuditSubscriber.onModuleInit() —
 * each context registers its own provider here rather than PermissionGuard
 * needing to import every context module directly (which would risk
 * circular imports, since those modules already import AuthModule for the
 * guards themselves).
 */
@Injectable()
export class ResourceScopeRegistry {
  private readonly logger = new Logger(ResourceScopeRegistry.name);
  private readonly providers = new Map<string, ResourceScopeProvider>();

  register(resourceType: string, provider: ResourceScopeProvider): void {
    this.providers.set(resourceType, provider);
    this.logger.debug(`Registered ResourceScopeProvider for "${resourceType}"`);
  }

  async resolve(resourceType: string, resourceId: string): Promise<ResourceScopeInfo | null> {
    const provider = this.providers.get(resourceType);
    if (!provider) {
      throw new Error(
        `No ResourceScopeProvider registered for resourceType "${resourceType}" — check that the owning context's provider calls registry.register() in onModuleInit().`,
      );
    }
    return provider.getScopeInfo(resourceId);
  }
}
