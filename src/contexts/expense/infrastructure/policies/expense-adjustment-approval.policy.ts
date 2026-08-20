// src/contexts/expense/infrastructure/policies/expense-adjustment-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { AdjustmentApprovalPolicy } from '../../../../shared-kernel/workflow/adjustment-approval-policy.port';

@Injectable()
export class ExpenseAdjustmentApprovalPolicy implements AdjustmentApprovalPolicy {
  // ₦1,000,000 in kobo — deliberately higher than the finance-director
  // threshold in ExpenseApprovalPolicy: small corrections shouldn't need
  // re-approval, but large reversals should, per your note.
  //
  // Grouped as <naira>_00 so the kobo tail is visible: 1_000_000 naira, then
  // _00. This literal read 100_000_00n (₦100,000) while claiming ₦1,000,000 —
  // the 10x defect TECH_DEBT #10 records. The MAGNITUDE is fixed; whether
  // ₦1,000,000 is the policy Ratel-Plus actually wants is still unconfirmed
  // and remains open under that same item.
  private static readonly REAPPROVAL_THRESHOLD_MINOR_UNITS = 1_000_000_00n;

  requiresApproval(amountMinorUnits: bigint, _reason: string): boolean {
    const absolute = amountMinorUnits < 0n ? -amountMinorUnits : amountMinorUnits;
    return absolute >= ExpenseAdjustmentApprovalPolicy.REAPPROVAL_THRESHOLD_MINOR_UNITS;
  }
}