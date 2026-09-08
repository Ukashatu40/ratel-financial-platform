// src/contexts/payroll/application/salary-structure/salary-structure.handlers.ts
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler } from '../../../../shared-kernel/cqrs/command-handler';
import { QueryHandler } from '../../../../shared-kernel/cqrs/query-handler';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import { OutboxService } from '../../../../shared-kernel/outbox/outbox.service';
import { EntityNotFoundError } from '../../../../shared-kernel/errors/domain-error';
import {
  SALARY_STRUCTURE_REPOSITORY,
  SalaryStructureRepository,
} from '../../domain/ports/salary-structure-repository.port';
import {
  SalaryStructure,
  SalaryStructureAlreadyExistsError,
} from '../../domain/aggregates/salary-structure.aggregate';
import {
  serializeLineItems,
  SerializedSalaryLineItem,
} from '../../domain/value-objects/salary-line-item';
import {
  CreateSalaryStructureCommand,
  CreateSalaryStructureVersionCommand,
} from './salary-structure.commands';
import { GetActiveSalaryStructureQuery } from './salary-structure.queries';

export interface SalaryStructureView {
  id: string;
  employeeId: string;
  version: number;
  effectiveFrom: string;
  baseSalaryLineItems: SerializedSalaryLineItem[];
}

@Injectable()
export class CreateSalaryStructureHandler implements CommandHandler<
  CreateSalaryStructureCommand,
  { id: string }
> {
  constructor(
    @Inject(SALARY_STRUCTURE_REPOSITORY) private readonly repo: SalaryStructureRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CreateSalaryStructureCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const existing = await this.repo.findActiveForEmployee(cmd.employeeId, tx);
      if (existing) {
        throw new SalaryStructureAlreadyExistsError(cmd.employeeId);
      }

      const structure = SalaryStructure.createInitialVersion({
        organizationId: cmd.organizationId,
        employeeId: cmd.employeeId,
        effectiveFrom: cmd.effectiveFrom,
        baseSalaryLineItems: cmd.baseSalaryLineItems,
      });

      await this.repo.save(structure, tx);
      await this.outbox.enqueue(structure.pullDomainEvents(), tx);

      return { id: structure.id };
    });
  }
}

@Injectable()
export class CreateSalaryStructureVersionHandler implements CommandHandler<
  CreateSalaryStructureVersionCommand,
  { id: string }
> {
  constructor(
    @Inject(SALARY_STRUCTURE_REPOSITORY) private readonly repo: SalaryStructureRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async execute(cmd: CreateSalaryStructureVersionCommand): Promise<{ id: string }> {
    return this.uow.transaction(async (tx) => {
      const previous = await this.repo.findActiveForEmployee(cmd.employeeId, tx);
      if (!previous || previous.toProps().organizationId !== cmd.organizationId) {
        throw new EntityNotFoundError('SalaryStructure', cmd.employeeId);
      }

      const next = SalaryStructure.createNextVersion(previous, {
        effectiveFrom: cmd.effectiveFrom,
        baseSalaryLineItems: cmd.baseSalaryLineItems,
      });
      previous.close(next.toProps().effectiveFrom);

      await this.repo.saveNextVersion(previous, next, tx);
      await this.outbox.enqueue([...previous.pullDomainEvents(), ...next.pullDomainEvents()], tx);

      return { id: next.id };
    });
  }
}

@Injectable()
export class GetActiveSalaryStructureHandler implements QueryHandler<
  GetActiveSalaryStructureQuery,
  SalaryStructureView
> {
  constructor(
    @Inject(SALARY_STRUCTURE_REPOSITORY) private readonly repo: SalaryStructureRepository,
  ) {}

  async execute(query: GetActiveSalaryStructureQuery): Promise<SalaryStructureView> {
    const structure = await this.repo.findActiveForEmployee(query.employeeId);
    if (!structure || structure.toProps().organizationId !== query.organizationId) {
      throw new EntityNotFoundError('SalaryStructure', query.employeeId);
    }

    const props = structure.toProps();
    return {
      id: props.id,
      employeeId: props.employeeId,
      version: props.version,
      effectiveFrom: props.effectiveFrom.toISOString(),
      baseSalaryLineItems: serializeLineItems(props.baseSalaryLineItems),
    };
  }
}
