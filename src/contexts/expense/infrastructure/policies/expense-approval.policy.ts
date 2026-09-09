// src/contexts/expense/infrastructure/policies/expense-approval.policy.ts
import { Injectable } from '@nestjs/common';
import { Approvable } from '../../../../shared-kernel/workflow/approvable';
import { ApprovalChain, ApprovalStep } from '../../../../shared-kernel/workflow/approval-chain';
import { ApprovalPolicy } from '../../../../shared-kernel/workflow/approval-policy.port';

/**
 * TECH_DEBT #10's original "still open" business question — is ₦500,000/
 * ₦1,000,000 actually the figure Ratel-Plus wants? — is now answered and
 * replaced with a confirmed three-tier policy:
 *   - up to and including ₦100,000: a single department_head, scoped to
 *     the expense's OWN department (unchanged shape from before).
 *   - above ₦100,000 and below ₦1,000,000: a panel of 3 DIFFERENT
 *     department_heads.
 *   - ₦1,000,000 and above: the same 3-department_head panel, PLUS
 *     finance_director.
 *
 * Boundary semantics: "at threshold escalates," consistent with this
 * codebase's existing convention (documented previously for the single
 * ₦500,000 line) — <= 100,000 is tier 1, exactly 1,000,000 is tier 3, so
 * every amount resolves to exactly one tier with no gap.
 *
 * The panel tiers deliberately use requiredScope: 'organization', not
 * 'department' — a department normally has exactly one department_head,
 * so "3 DIFFERENT department_heads" is structurally impossible if scoped
 * to the expense's own department. 'organization' scope means any user
 * holding department_head ANYWHERE in the org can fill a panel seat (see
 * WorkflowEngine.recordApproval()'s scope check), and the "3 DIFFERENT"
 * requirement is enforced separately by WorkflowEngine's chain-wide
 * duplicate-approver check — an approver who already filled one panel
 * seat cannot fill another.
 */
@Injectable()
export class ExpenseApprovalPolicy implements ApprovalPolicy {
  private static readonly DEPARTMENT_HEAD_SOLE_THRESHOLD_MINOR_UNITS = 100_000_00n; // ₦100,000
  private static readonly FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS = 1_000_000_00n; // ₦1,000,000

  resolveChain(item: Approvable): ApprovalChain {
    // Reused for both ordinary expenses (always positive) and adjustments
    // (a signed delta — see ExpenseAdjustmentApprovalPolicy and
    // Expense.createAdjustment()). TECH_DEBT #58's original lesson still
    // applies: compare the magnitude, never the signed value directly.
    const absoluteAmount =
      item.amountMinorUnits < 0n ? -item.amountMinorUnits : item.amountMinorUnits;

    if (absoluteAmount <= ExpenseApprovalPolicy.DEPARTMENT_HEAD_SOLE_THRESHOLD_MINOR_UNITS) {
      return ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
    }

    const departmentHeadPanel: ApprovalStep[] = [
      { order: 1, requiredRole: 'department_head', requiredScope: 'organization' },
      { order: 2, requiredRole: 'department_head', requiredScope: 'organization' },
      { order: 3, requiredRole: 'department_head', requiredScope: 'organization' },
    ];

    if (absoluteAmount < ExpenseApprovalPolicy.FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS) {
      return ApprovalChain.of(departmentHeadPanel);
    }

    return ApprovalChain.of([
      ...departmentHeadPanel,
      { order: 4, requiredRole: 'finance_director', requiredScope: 'organization' },
    ]);
  }
}
