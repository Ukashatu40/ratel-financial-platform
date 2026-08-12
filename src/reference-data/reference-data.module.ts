// src/reference-data/reference-data.module.ts
import { Module } from '@nestjs/common';
import { DepartmentController } from './presentation/department.controller';
import { VendorController } from './presentation/vendor.controller';
import { CategoryController } from './presentation/category.controller';
import { ProjectController } from './presentation/project.controller';
import {
  CreateDepartmentHandler,
  DeactivateDepartmentHandler,
  GetDepartmentByIdHandler,
  ListDepartmentsHandler,
  UpdateDepartmentHandler,
} from './application/department/department.handlers';
import {
  CreateVendorHandler,
  DeactivateVendorHandler,
  GetVendorByIdHandler,
  ListVendorsHandler,
  UpdateVendorHandler,
} from './application/vendor/vendor.handlers';
import {
  CreateCategoryHandler,
  DeactivateCategoryHandler,
  GetCategoryByIdHandler,
  ListCategoriesHandler,
  UpdateCategoryHandler,
} from './application/category/category.handlers';
import {
  CreateProjectHandler,
  DeactivateProjectHandler,
  GetProjectByIdHandler,
  ListProjectsHandler,
  UpdateProjectHandler,
} from './application/project/project.handlers';

@Module({
  controllers: [DepartmentController, VendorController, CategoryController, ProjectController],
  providers: [
    CreateDepartmentHandler,
    UpdateDepartmentHandler,
    DeactivateDepartmentHandler,
    GetDepartmentByIdHandler,
    ListDepartmentsHandler,
    CreateVendorHandler,
    UpdateVendorHandler,
    DeactivateVendorHandler,
    GetVendorByIdHandler,
    ListVendorsHandler,
    CreateCategoryHandler,
    UpdateCategoryHandler,
    DeactivateCategoryHandler,
    GetCategoryByIdHandler,
    ListCategoriesHandler,
    CreateProjectHandler,
    UpdateProjectHandler,
    DeactivateProjectHandler,
    GetProjectByIdHandler,
    ListProjectsHandler,
  ],
})
export class ReferenceDataModule {}
