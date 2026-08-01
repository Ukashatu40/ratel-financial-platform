// src/contexts/payroll/infrastructure/policies/payroll-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { Approvable } from '../../../../shared-kernel/workflow/approvable';
import { ApprovalChain } from '../../../../shared-kernel/workflow/approval-chain';
import { ApprovalPolicy } from '../../../../shared-kernel/workflow/approval-policy.port';

/**
 * Per Phase 9.1's role matrix: payroll approval is org-scoped only —
 * finance_director signs off on the whole month's run. No department_head
 * step exists here, unlike ExpenseApprovalPolicy, since payroll isn't
 * departmentally segmented the way expenses are (a payroll run spans every
 * department at once).
 *
 * This is the concrete proof the Workflow framework generalizes: same
 * ApprovalPolicy interface, same WorkflowEngine, same ApprovalChain/
 * ApprovalProgress machinery as Expense — only the resolved chain shape
 * differs, which is exactly what the interface was designed to allow.
 */
@Injectable()
export class PayrollApprovalPolicy implements ApprovalPolicy {
  resolveChain(_item: Approvable): ApprovalChain {
    // No amount-based branching (yet) — every payroll run requires finance
    // director sign-off regardless of total, since payroll's sensitivity
    // comes from what it contains, not its size, unlike expense thresholds.
    return ApprovalChain.of([
      { order: 1, requiredRole: 'finance_director', requiredScope: 'organization' },
    ]);
  }
}