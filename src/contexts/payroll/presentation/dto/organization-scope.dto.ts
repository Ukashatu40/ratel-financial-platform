// src/contexts/payroll/presentation/dto/organization-scope.dto.ts
import { IsUUID } from 'class-validator';

export class OrganizationScopeDto {
  @IsUUID()
  organizationId!: string;
}
