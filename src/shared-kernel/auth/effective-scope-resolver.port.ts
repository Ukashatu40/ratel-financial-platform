// src/shared-kernel/auth/effective-scope-resolver.port.ts
export type EffectiveScope = 'organization' | 'department' | 'own' | null;

export interface EffectiveScopeResolver {
  /** Widest scope the given roles grant for this permission — mirrors
   * PermissionGuard's own "organization beats department beats own"
   * short-circuit logic (Phase 9.1), but as a queryable filter-basis
   * rather than an allow/deny decision. */
  resolveWidestScope(roles: string[], permission: string): Promise<EffectiveScope>;
}

export const EFFECTIVE_SCOPE_RESOLVER = Symbol('EFFECTIVE_SCOPE_RESOLVER');
