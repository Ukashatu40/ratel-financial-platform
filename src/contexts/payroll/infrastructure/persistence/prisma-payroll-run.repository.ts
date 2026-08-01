// src/contexts/payroll/infrastructure/persistence/prisma-payroll-run.repository.ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TransactionClient } from '../../../../shared-kernel/unit-of-work/unit-of-work.port';
import {
  ENCRYPTION_SERVICE,
  EncryptionService,
} from '../../../../shared-kernel/encryption/encryption.port';
import { Money } from '../../../../shared-kernel/money/money.vo';
import { PayrollRun, PayrollRunProps } from '../../domain/aggregates/payroll-run.aggregate';
import { Payslip, PayslipProps } from '../../domain/entities/payslip.entity';
import { PayrollRunRepository } from '../../domain/ports/payroll-run-repository.port';
import { SalaryLineItem } from '../../domain/value-objects/salary-line-item';
import { TaxComputation } from '../../domain/value-objects/tax-computation';
import {
  deserializeLineItems,
  serializeLineItems,
  SerializedSalaryLineItem,
} from '../../domain/value-objects/salary-line-item';
import {
  deserializeTaxComputation,
  serializeTaxComputation,
  SerializedTaxComputation,
} from '../../domain/value-objects/tax-computation';

interface SerializedPayslipDetail {
  salaryStructureSnapshot: Record<string, unknown>; // already JSON-safe (toSnapshot() serializes internally now)
  lineItems: SerializedSalaryLineItem[];
  taxComputation: SerializedTaxComputation;
}

interface EncryptedPayslipDetail {
  salaryStructureSnapshot: Record<string, unknown>;
  lineItems: SalaryLineItem[];
  taxComputation: TaxComputation;
}

@Injectable()
export class PrismaPayrollRunRepository implements PayrollRunRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_SERVICE) private readonly encryption: EncryptionService,
  ) {}

  async findById(id: string, tx?: TransactionClient): Promise<PayrollRun | null> {
    const client = tx ?? this.prisma;
    const row = await client.payrollRun.findUnique({
      where: { id },
      include: { payslips: true },
    });
    if (!row) return null;
    return this.toDomain(row, row.payslips);
  }

  async findByOrgAndMonth(
    organizationId: string,
    runMonth: Date,
    tx?: TransactionClient,
  ): Promise<PayrollRun | null> {
    const client = tx ?? this.prisma;
    const row = await client.payrollRun.findFirst({
      where: { organizationId, runMonth },
      include: { payslips: true },
    });
    return row ? this.toDomain(row, row.payslips) : null;
  }

  async save(run: PayrollRun, tx: TransactionClient): Promise<void> {
    const props = run.toProps();

    await tx.payrollRun.upsert({
      where: { id: props.id },
      create: {
        id: props.id,
        organizationId: props.organizationId,
        periodId: props.periodId,
        status: props.status as any,
        runMonth: props.runMonth,
        createdById: props.createdById,
        approvedById: props.approvedById,
        approvedAt: props.approvedAt,
        createdAt: props.createdAt,
      },
      update: {
        status: props.status as any,
        approvedById: props.approvedById,
        approvedAt: props.approvedAt,
      },
    });

    // Only persist payslips not already saved — addPayslip() appends to the
    // in-memory array, so save() flushes the delta rather than re-writing
    // everything (same pattern as ApprovalProgressRepository.save() in the
    // shared kernel).
    const existingIds = new Set(
      (
        await tx.payslip.findMany({
          where: { payrollRunId: props.id },
          select: { employeeId: true },
        })
      ).map((p) => p.employeeId),
    );
    const newPayslips = run.getPayslips.filter((p) => !existingIds.has(p.employeeId));

    for (const payslip of newPayslips) {
      const payslipProps = payslip.toProps();
      const encryptedDetail = await this.encryption.encryptJson<SerializedPayslipDetail>({
        salaryStructureSnapshot: payslipProps.salaryStructureSnapshot,
        lineItems: serializeLineItems(payslipProps.lineItems),
        taxComputation: serializeTaxComputation(payslipProps.taxComputation),
      });

      await tx.payslip.create({
        data: {
          id: payslipProps.id,
          payrollRunId: props.id,
          employeeId: payslipProps.employeeId,
          grossPayMinorUnits: payslipProps.grossPay.minorUnits,
          netPayMinorUnits: payslipProps.netPay.minorUnits,
          currency: payslipProps.grossPay.currencyCode,
          encryptedDetail: Buffer.from(encryptedDetail),
          createdAt: payslipProps.createdAt,
        },
      });
    }
  }

  private async toDomain(
    row: {
      id: string;
      organizationId: string;
      periodId: string;
      status: string;
      runMonth: Date;
      createdById: string;
      approvedById: string | null;
      approvedAt: Date | null;
      createdAt: Date;
    },
    payslipRows: Array<{
      id: string;
      employeeId: string;
      grossPayMinorUnits: bigint;
      netPayMinorUnits: bigint;
      currency: string;
      encryptedDetail: Uint8Array;
      createdAt: Date;
    }>,
  ): Promise<PayrollRun> {
    const props: PayrollRunProps = {
      id: row.id,
      organizationId: row.organizationId,
      periodId: row.periodId,
      status: row.status as any,
      runMonth: row.runMonth,
      createdById: row.createdById,
      approvedById: row.approvedById,
      approvedAt: row.approvedAt,
      createdAt: row.createdAt,
    };

    const payslips = await Promise.all(
      payslipRows.map(async (p) => {
        const detail = await this.encryption.decryptJson<SerializedPayslipDetail>(
          Buffer.from(p.encryptedDetail),
        );
        const payslipProps: PayslipProps = {
          id: p.id,
          employeeId: p.employeeId,
          salaryStructureSnapshot: detail.salaryStructureSnapshot,
          lineItems: deserializeLineItems(detail.lineItems),
          taxComputation: deserializeTaxComputation(detail.taxComputation),
          grossPay: Money.of(p.grossPayMinorUnits, p.currency),
          netPay: Money.of(p.netPayMinorUnits, p.currency),
          createdAt: p.createdAt,
        };
        return Payslip.reconstitute(payslipProps);
      }),
    );

    return PayrollRun.reconstitute(props, payslips);
  }
}
