// src/contexts/expense/infrastructure/policies/expense-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { Approvable } from '../../../../shared-kernel/workflow/approvable';
import { ApprovalChain } from '../../../../shared-kernel/workflow/approval-chain';
import { ApprovalPolicy } from '../../../../shared-kernel/workflow/approval-policy.port';

/**
 * Simple threshold-based policy for v1 — this is deliberately the ONLY
 * place expense-specific approval rules live. Changing the threshold or
 * adding a second approval tier means editing this one file; nothing in
 * the aggregate, the engine, or the handler needs to change (Phase 5.6's
 * reasoning for Strategy pattern applied concretely).
 */
@Injectable()
export class ExpenseApprovalPolicy implements ApprovalPolicy {
  // ₦500,000 in kobo. Grouped as <naira>_00 so the kobo tail is visible:
  // 500_000 naira, then _00. One digit short here is a 10x policy error and
  // is exactly the defect TECH_DEBT #10 records — this literal read
  // 50_000_00n (₦50,000) while claiming to be ₦500,000, so every expense from
  // ₦50,000 up was wrongly escalated to a finance_director. Covered by
  // test/unit/contexts/expense/expense-approval.policy.spec.ts, which asserts
  // the threshold in naira precisely so the same slip cannot recur silently.
  private static readonly FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS = 500_000_00n;

  resolveChain(item: Approvable): ApprovalChain {
    if (item.amountMinorUnits < ExpenseApprovalPolicy.FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS) {
      return ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
    }

    return ApprovalChain.of([
      { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
    ]);
  }
}