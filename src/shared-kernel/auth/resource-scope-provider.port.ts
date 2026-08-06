// src/shared-kernel/auth/resource-scope-provider.port.ts
export interface ResourceScopeInfo {
  departmentId: string | null;
  requesterId: string;
}

export interface ResourceScopeProvider {
  getScopeInfo(resourceId: string): Promise<ResourceScopeInfo | null>;
}
