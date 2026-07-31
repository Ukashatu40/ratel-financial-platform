// src/contexts/expense/infrastructure/policies/expense-adjustment-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { AdjustmentApprovalPolicy } from '../../../../shared-kernel/workflow/adjustment-approval-policy.port';

@Injectable()
export class ExpenseAdjustmentApprovalPolicy implements AdjustmentApprovalPolicy {
  // ₦1,000,000 in kobo — deliberately higher than the finance-director
  // threshold in ExpenseApprovalPolicy: small corrections shouldn't need
  // re-approval, but large reversals should, per your note.
  private static readonly REAPPROVAL_THRESHOLD_MINOR_UNITS = 100_000_00n;

  requiresApproval(amountMinorUnits: bigint, _reason: string): boolean {
    const absolute = amountMinorUnits < 0n ? -amountMinorUnits : amountMinorUnits;
    return absolute >= ExpenseAdjustmentApprovalPolicy.REAPPROVAL_THRESHOLD_MINOR_UNITS;
  }
}