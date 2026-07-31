// src/contexts/expense/infrastructure/policies/expense-approval.policy.ts
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
  private static readonly DEPARTMENT_HEAD_THRESHOLD = 0n;
  private static readonly FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS = 50_000_00n; // ₦500,000 in kobo

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