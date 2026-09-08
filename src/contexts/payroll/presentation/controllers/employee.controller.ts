// src/contexts/payroll/presentation/controllers/employee.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../auth/authentication/jwt-auth.guard';
import { PermissionGuard } from '../../../../auth/authorization/permission.guard';
import { RequirePermission } from '../../../../auth/authorization/permission.decorator';
import { CurrentUser } from '../../../../auth/authentication/current-user.decorator';
import { UserPrincipal } from '../../../../shared-kernel/auth/user-principal';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';
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
import {
  CreateSalaryStructureHandler,
  CreateSalaryStructureVersionHandler,
  GetActiveSalaryStructureHandler,
} from '../../application/salary-structure/salary-structure.handlers';
import {
  CreateSalaryStructureCommand,
  CreateSalaryStructureVersionCommand,
} from '../../application/salary-structure/salary-structure.commands';
import { GetActiveSalaryStructureQuery } from '../../application/salary-structure/salary-structure.queries';
import { CreateEmployeeDto, LinkUserDto, ListEmployeesDto } from '../dto/employee.dto';
import { CreateSalaryStructureDto } from '../dto/salary-structure.dto';

const DEFAULT_CURRENCY = 'NGN';

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
    private readonly createSalaryStructure: CreateSalaryStructureHandler,
    private readonly createSalaryStructureVersion: CreateSalaryStructureVersionHandler,
    private readonly getActiveSalaryStructure: GetActiveSalaryStructureHandler,
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

  @ApiOperation({ summary: "Create an employee's initial salary structure (version 1)" })
  @RequirePermission('payroll:create')
  @Post(':id/salary-structure')
  async createStructure(
    @Param('id') id: string,
    @Body() dto: CreateSalaryStructureDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string }> {
    return this.createSalaryStructure.execute(
      new CreateSalaryStructureCommand(
        user.organizationId,
        id,
        new Date(dto.effectiveFrom),
        toDomainLineItems(dto.baseSalaryLineItems),
      ),
    );
  }

  @ApiOperation({
    summary: "Create the next version of an employee's salary structure, closing the previous one",
  })
  @RequirePermission('payroll:create')
  @Post(':id/salary-structure/versions')
  async createStructureVersion(
    @Param('id') id: string,
    @Body() dto: CreateSalaryStructureDto,
    @CurrentUser() user: UserPrincipal,
  ): Promise<{ id: string }> {
    return this.createSalaryStructureVersion.execute(
      new CreateSalaryStructureVersionCommand(
        user.organizationId,
        id,
        new Date(dto.effectiveFrom),
        toDomainLineItems(dto.baseSalaryLineItems),
      ),
    );
  }

  @ApiOperation({ summary: "Get an employee's currently active salary structure" })
  @RequirePermission('payroll:create')
  @Get(':id/salary-structure')
  async getStructure(@Param('id') id: string, @CurrentUser() user: UserPrincipal) {
    return this.getActiveSalaryStructure.execute(
      new GetActiveSalaryStructureQuery(id, user.organizationId),
    );
  }
}

function toDomainLineItems(
  dtoItems: CreateSalaryStructureDto['baseSalaryLineItems'],
): SalaryLineItem[] {
  return dtoItems.map((item) => ({
    kind: item.kind,
    label: item.label,
    amount: Money.of(BigInt(item.amountMinorUnits), DEFAULT_CURRENCY),
  }));
}
