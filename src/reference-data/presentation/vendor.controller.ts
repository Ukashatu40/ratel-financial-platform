// src/reference-data/presentation/vendor.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  CreateVendorHandler,
  DeactivateVendorHandler,
  GetVendorByIdHandler,
  ListVendorsHandler,
  UpdateVendorHandler,
} from '../application/vendor/vendor.handlers';
import {
  CreateVendorCommand,
  DeactivateVendorCommand,
  UpdateVendorCommand,
} from '../application/vendor/vendor.commands';
import { GetVendorByIdQuery, ListVendorsQuery } from '../application/vendor/vendor.queries';
import {
  CreateDepartmentDto as CreateVendorDto,
  ListReferenceDataDto,
  UpdateDepartmentDto as UpdateVendorDto,
} from './department.dto'; // identical DTO shape, reused

@ApiTags('Reference Data — Vendors')
@ApiBearerAuth('access-token')
@Controller({ path: 'vendors', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class VendorController {
  constructor(
    private readonly createVendor: CreateVendorHandler,
    private readonly updateVendor: UpdateVendorHandler,
    private readonly deactivateVendor: DeactivateVendorHandler,
    private readonly getVendorById: GetVendorByIdHandler,
    private readonly listVendors: ListVendorsHandler,
  ) {}

  @ApiOperation({ summary: 'Create a vendor' })
  @RequirePermission('reference-data:manage')
  @Post()
  async create(@Body() dto: CreateVendorDto, @CurrentUser() user: UserPrincipal) {
    return this.createVendor.execute(new CreateVendorCommand(user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Rename a vendor' })
  @RequirePermission('reference-data:manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    await this.updateVendor.execute(new UpdateVendorCommand(id, user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Deactivate a vendor' })
  @RequirePermission('reference-data:manage')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deactivateVendor.execute(
      new DeactivateVendorCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Get a vendor by ID' })
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getVendorById.execute(new GetVendorByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List vendors (active only by default)' })
  @Get()
  async list(@Query() dto: ListReferenceDataDto, @CurrentUser() user: UserPrincipal) {
    return this.listVendors.execute(new ListVendorsQuery(user.organizationId, dto.includeInactive));
  }
}
