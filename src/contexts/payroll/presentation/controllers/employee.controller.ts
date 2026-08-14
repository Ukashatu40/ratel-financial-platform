// src/contexts/payroll/presentation/controllers/employee.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import {
  CreateEmployeeHandler,
  LinkEmployeeToUserHandler,
  UnlinkEmployeeFromUserHandler,
  DeactivateEmployeeHandler,
  GetEmployeeByIdHandler,
  ListEmployeesHandler,
} from '../../application/employee/employee.handlers';
import {
  CreateEmployeeCommand,
  LinkEmployeeToUserCommand,
  UnlinkEmployeeFromUserCommand,
  DeactivateEmployeeCommand,
} from '../../application/employee/employee.commands';
import {
  GetEmployeeByIdQuery,
  ListEmployeesQuery,
} from '../../application/employee/employee.queries';
import { CreateEmployeeDto, LinkUserDto, ListEmployeesDto } from '../dto/employee.dto';

@ApiTags('Employees')
@ApiBearerAuth('access-token')
@Controller({ path: 'employees', version: '1' })
@UseGuards(JwtAuthGuard, PermissionGuard)
export class EmployeeController {
  constructor(
    private readonly createEmployee: CreateEmployeeHandler,
    private readonly linkEmployeeToUser: LinkEmployeeToUserHandler,
    private readonly unlinkEmployeeFromUser: UnlinkEmployeeFromUserHandler,
    private readonly deactivateEmployee: DeactivateEmployeeHandler,
    private readonly getEmployeeById: GetEmployeeByIdHandler,
    private readonly listEmployees: ListEmployeesHandler,
  ) {}

  @ApiOperation({ summary: 'Create an employee (payroll record)' })
  @RequirePermission('payroll:create')
  @Post()
  async create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: UserPrincipal) {
    return this.createEmployee.execute(
      new CreateEmployeeCommand(user.organizationId, dto.fullName),
    );
  }

  @ApiOperation({ summary: "Link an employee's payroll record to their login account" })
  @RequirePermission('payroll:create')
  @Patch(':id/link-user')
  async linkUser(
    @Param('id') id: string,
    @Body() dto: LinkUserDto,
    @CurrentUser() user: UserPrincipal,
  ) {
    await this.linkEmployeeToUser.execute(
      new LinkEmployeeToUserCommand(id, user.organizationId, dto.userId),
    );
  }

  @ApiOperation({ summary: 'Unlink an employee from their login account' })
  @RequirePermission('payroll:create')
  @Patch(':id/unlink-user')
  async unlinkUser(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.unlinkEmployeeFromUser.execute(
      new UnlinkEmployeeFromUserCommand(id, user.organizationId),
    );
  }

  @ApiOperation({
    summary: 'Deactivate an employee (soft delete — historical payslips are untouched)',
  })
  @RequirePermission('payroll:create')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    await this.deactivateEmployee.execute(
      new DeactivateEmployeeCommand(id, user.organizationId, user.id),
    );
  }

  @ApiOperation({ summary: 'Get an employee by ID' })
  @RequirePermission('payroll:create')
  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getEmployeeById.execute(new GetEmployeeByIdQuery(id, user.organizationId));
  }

  @ApiOperation({ summary: 'List employees (active only by default)' })
  @RequirePermission('payroll:create')
  @Get()
  async list(@Query() dto: ListEmployeesDto, @CurrentUser() user: UserPrincipal) {
    return this.listEmployees.execute(
      new ListEmployeesQuery(user.organizationId, dto.includeInactive),
    );
  }
}
