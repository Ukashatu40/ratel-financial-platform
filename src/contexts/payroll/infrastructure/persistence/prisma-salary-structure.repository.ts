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
// import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';
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

  async save(structure: SalaryStructure, tx: TransactionClient): Promise<void> {
    const props = structure.toProps();
    const encryptedLineItems = await this.encryption.encryptJson(
      serializeLineItems(props.baseSalaryLineItems),
    );

    if (props.version > 1) {
      await tx.salaryStructure.updateMany({
        where: { employeeId: props.employeeId, effectiveTo: null, version: { lt: props.version } },
        data: { effectiveTo: props.effectiveFrom },
      });
    }

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
}
