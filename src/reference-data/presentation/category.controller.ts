// src/reference-data/presentation/category.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../auth/authorization/permission.guard';
import { RequirePermission } from '../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../shared-kernel/auth/user-principal';
import {
  CreateCategoryHandler,
  DeactivateCategoryHandler,
  GetCategoryByIdHandler,
  ListCategoriesHandler,
  UpdateCategoryHandler,
} from '../application/category/category.handlers';
import {
  CreateCategoryCommand,
  DeactivateCategoryCommand,
  UpdateCategoryCommand,
} from '../application/category/category.commands';
import {
  GetCategoryByIdQuery,
  ListCategoriesQuery,
} from '../application/category/category.queries';
import {
  CreateDepartmentDto as CreateCategoryDto,
  ListReferenceDataDto,
  UpdateDepartmentDto as UpdateCategoryDto,
} from './department.dto';

@ApiTags('Reference Data — Categories')
@ApiBearerAuth('access-token')
@Controller({ path: 'categories', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CategoryController {
  constructor(
    private readonly createCategory: CreateCategoryHandler,
    private readonly updateCategory: UpdateCategoryHandler,
    private readonly deactivateCategory: DeactivateCategoryHandler,
    private readonly getCategoryById: GetCategoryByIdHandler,
    private readonly listCategories: ListCategoriesHandler,
  ) {}

  @ApiOperation({ summary: 'Create an expense category' })
  @RequirePermission('reference-data:manage')
  @Post()
  async create(@Body() dto: CreateCategoryDto, @CurrentUser() user: UserPrincipal) {
    return this.createCategory.execute(new CreateCategoryCommand(user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Rename a category' })
  @RequirePermission('reference-data:manage')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    await this.updateCategory.execute(new UpdateCategoryCommand(id, user.organizationId, dto.name));
  }

  @ApiOperation({ summary: 'Deactivate a category' })
  @RequirePermission('reference-data:manage')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deactivateCategory.execute(
      new DeactivateCategoryCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Get a category by ID' })
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getCategoryById.execute(new GetCategoryByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List categories (active only by default)' })
  @Get()
  async list(@Query() dto: ListReferenceDataDto, @CurrentUser() user: UserPrincipal) {
    return this.listCategories.execute(
      new ListCategoriesQuery(user.organizationId, dto.includeInactive),
    );
  }
}
