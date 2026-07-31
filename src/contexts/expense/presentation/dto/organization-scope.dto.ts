// src/contexts/expense/presentation/dto/organization-scope.dto.ts
import { IsUUID } from 'class-validator';

// Shared body shape for endpoints that only need organizationId — approve/
// submit/cancel all use this rather than each declaring an identical class.
export class OrganizationScopeDto {
  @IsUUID()
  organizationId!: string;
}