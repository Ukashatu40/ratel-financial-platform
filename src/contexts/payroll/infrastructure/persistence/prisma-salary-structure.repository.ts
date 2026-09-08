// src/contexts/payroll/infrastructure/persistence/prisma-salary-structure.repository.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import {
  ENCRYPTION_SERVICE,
  EncryptionService,
} from '../../../../shared-kernel/encryption/encryption.port';
import { SalaryStructure } from '../../domain/aggregates/salary-structure.aggregate';
import { SalaryStructureRepository } from '../../domain/ports/salary-structure-repository.port';
import {
  deserializeLineItems,
  serializeLineItems,
  SerializedSalaryLineItem,
} from '../../domain/value-objects/salary-line-item';

@Injectable()
export class PrismaSalaryStructureRepository implements SalaryStructureRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_SERVICE) private readonly encryption: EncryptionService,
  ) {}

  async findActiveForEmployee(
    employeeId: string,
    tx?: TransactionClient,
  ): Promise<SalaryStructure | null> {
    const client = tx ?? this.prisma;
    const row = await client.salaryStructure.findFirst({
      where: { employeeId, effectiveTo: null },
      orderBy: { version: 'desc' },
    });
    if (!row) return null;

    const serialized = await this.encryption.decryptJson<SerializedSalaryLineItem[]>(
      Buffer.from(row.encryptedLineItems),
    );
    const lineItems = deserializeLineItems(serialized);

    return SalaryStructure.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      employeeId: row.employeeId,
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      baseSalaryLineItems: lineItems,
      createdAt: row.createdAt,
    });
  }

  /**
   * TECH_DEBT #56 — no longer derives a closing UPDATE for anything. Purely
   * inserts the given structure as its own new row, at whatever version and
   * effectiveTo it already carries. Closing a PREVIOUS version is now
   * saveNextVersion()'s job, driven by that instance's own mutated state.
   */
  async save(structure: SalaryStructure, tx: TransactionClient): Promise<void> {
    const props = structure.toProps();
    const encryptedLineItems = await this.encryption.encryptJson(
      serializeLineItems(props.baseSalaryLineItems),
    );

    await tx.salaryStructure.create({
      data: {
        id: props.id,
        organizationId: props.organizationId,
        employeeId: props.employeeId,
        version: props.version,
        effectiveFrom: props.effectiveFrom,
        effectiveTo: props.effectiveTo,
        encryptedLineItems: Buffer.from(encryptedLineItems),
        createdAt: props.createdAt,
      },
    });
  }

  async saveNextVersion(
    previous: SalaryStructure,
    next: SalaryStructure,
    tx: TransactionClient,
  ): Promise<void> {
    const previousProps = previous.toProps();

    // Scoped by primary key — strictly tighter than the old employeeId-only
    // filter this replaces, and makes the #56 investigation's flagged
    // "no organizationId in the WHERE clause" concern moot: a lookup by id
    // cannot cross tenants by construction, so no additional predicate is
    // needed here. Value comes from previous's OWN mutated props (set by
    // previous.close()), not re-derived from `next`.
    await tx.salaryStructure.update({
      where: { id: previousProps.id },
      data: { effectiveTo: previousProps.effectiveTo },
    });

    await this.save(next, tx);
  }
}
