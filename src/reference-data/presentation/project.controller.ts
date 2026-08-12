// src/reference-data/presentation/project.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  CreateProjectHandler,
  DeactivateProjectHandler,
  GetProjectByIdHandler,
  ListProjectsHandler,
  UpdateProjectHandler,
} from '../application/project/project.handlers';
import {
  CreateProjectCommand,
  DeactivateProjectCommand,
  UpdateProjectCommand,
} from '../application/project/project.commands';
import { GetProjectByIdQuery, ListProjectsQuery } from '../application/project/project.queries';
import {
  CreateDepartmentDto as CreateProjectDto,
  ListReferenceDataDto,
  UpdateDepartmentDto as UpdateProjectDto,
} from './department.dto';

@ApiTags('Reference Data — Projects')
@ApiBearerAuth('access-token')
@Controller({ path: 'projects', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProjectController {
  constructor(
    private readonly createProject: CreateProjectHandler,
    private readonly updateProject: UpdateProjectHandler,
    private readonly deactivateProject: DeactivateProjectHandler,
    private readonly getProjectById: GetProjectByIdHandler,
    private readonly listProjects: ListProjectsHandler,
  ) {}

  @ApiOperation({ summary: 'Create a project' })
  @RequirePermission('reference-data:manage')
  @Post()
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: UserPrincipal) {
    return this.createProject.execute(new CreateProjectCommand(user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Rename a project' })
  @RequirePermission('reference-data:manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    await this.updateProject.execute(new UpdateProjectCommand(id, user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Deactivate a project' })
  @RequirePermission('reference-data:manage')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deactivateProject.execute(
      new DeactivateProjectCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Get a project by ID' })
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getProjectById.execute(new GetProjectByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List projects (active only by default)' })
  @Get()
  async list(@Query() dto: ListReferenceDataDto, @CurrentUser() user: UserPrincipal) {
    return this.listProjects.execute(
      new ListProjectsQuery(user.organizationId, dto.includeInactive),
    );
  }
}
