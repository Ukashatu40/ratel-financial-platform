// src/reference-data/presentation/department.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  CreateDepartmentHandler,
  DeactivateDepartmentHandler,
  GetDepartmentByIdHandler,
  ListDepartmentsHandler,
  UpdateDepartmentHandler,
} from '../application/department/department.handlers';
import {
  CreateDepartmentCommand,
  DeactivateDepartmentCommand,
  UpdateDepartmentCommand,
} from '../application/department/department.commands';
import {
  GetDepartmentByIdQuery,
  ListDepartmentsQuery,
} from '../application/department/department.queries';
import { CreateDepartmentDto, ListReferenceDataDto, UpdateDepartmentDto } from './department.dto';

@ApiTags('Reference Data — Departments')
@ApiBearerAuth('access-token')
@Controller({ path: 'departments', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class DepartmentController {
  constructor(
    private readonly createDepartment: CreateDepartmentHandler,
    private readonly updateDepartment: UpdateDepartmentHandler,
    private readonly deactivateDepartment: DeactivateDepartmentHandler,
    private readonly getDepartmentById: GetDepartmentByIdHandler,
    private readonly listDepartments: ListDepartmentsHandler,
  ) {}

  @ApiOperation({ summary: 'Create a department' })
  @RequirePermission('reference-data:manage')
  @Post()
  async create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: UserPrincipal) {
    return this.createDepartment.execute(
      new CreateDepartmentCommand(user.organizationId, dto.name),
    );
  }

  @ApiOperation({ summary: 'Rename a department' })
  @RequirePermission('reference-data:manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    await this.updateDepartment.execute(
      new UpdateDepartmentCommand(id, user.organizationId, dto.name),
    );
  }

  @ApiOperation({
    summary: 'Deactivate a department (soft delete — historical expenses keep referencing it)',
  })
  @RequirePermission('reference-data:manage')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deactivateDepartment.execute(
      new DeactivateDepartmentCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Get a department by ID' })
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getDepartmentById.execute(new GetDepartmentByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List departments (active only by default)' })
  @Get()
  async list(@Query() dto: ListReferenceDataDto, @CurrentUser() user: UserPrincipal) {
    return this.listDepartments.execute(
      new ListDepartmentsQuery(user.organizationId, dto.includeInactive),
    );
  }
}
