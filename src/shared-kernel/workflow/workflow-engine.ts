// src/shared-kernel/workflow/workflow-engine.ts
import { Inject, Injectable } from '@nestjs/common';
import { Approvable } from './approvable';
import { ApprovalPolicy } from './approval-policy.port';
import { ApprovalProgress } from './approval-progress';
import { DomainError, ApproverRoleMismatchError } from '../errors/domain-error';
import { USER_ROLE_SERVICE, UserRoleService } from '../auth/user-role.port';

export interface WorkflowDecision {
  isFinalApproval: boolean;
}

export class SelfApprovalNotAllowedError extends DomainError {
  readonly code = 'self-approval-not-allowed';
  readonly httpStatus = 403;

  constructor(itemId: string, approverId: string) {
    super(`Approver ${approverId} cannot approve item ${itemId} they themselves requested`);
  }
}

export class SelfRejectionNotAllowedError extends DomainError {
  readonly code = 'self-rejection-not-allowed';
  readonly httpStatus = 403;

  constructor(itemId: string, approverId: string) {
    super(`Approver ${approverId} cannot reject item ${itemId} they themselves requested`);
  }
}

/**
 * Separation of duties, generalized beyond "not consecutive": a chain can
 * now require the SAME role at multiple steps (e.g. ExpenseApprovalPolicy's
 * 3-department_head panel), so "no repeat at consecutive steps" is not
 * enough — steps 1 and 3 could otherwise be the same person with a
 * different approver only at step 2. Checked against every PRIOR approved
 * record in the chain, not just the immediately preceding one.
 */
export class DuplicateApproverInChainError extends DomainError {
  readonly code = 'duplicate-approver-in-chain';
  readonly httpStatus = 403;

  constructor(itemId: string, approverId: string) {
    super(
      `Approver ${approverId} has already approved a different step in this same approval chain for item ${itemId}`,
    );
  }
}

@Injectable()
export class WorkflowEngine {
  constructor(@Inject(USER_ROLE_SERVICE) private readonly userRoleService: UserRoleService) {}

  resolveChainFor(item: Approvable, policy: ApprovalPolicy) {
    return policy.resolveChain(item);
  }

  /**
   * Now async — this is the one call-site change every consumer (Expense's
   * and Payroll's approve handlers) needs to pick up with `await`. Three
   * checks now run, in order:
   *   1. Separation of duties: requester !== approver (unchanged).
   *   2. Separation of duties, chain-wide: this approver hasn't already
   *      approved an EARLIER step in this same chain — needed once a chain
   *      can require the same role at multiple steps (the department_head
   *      panel tiers in ExpenseApprovalPolicy).
   *   3. Role correctness: the approver must actually hold the role
   *      required by the CURRENT step in the chain — and if that step is
   *      department-scoped, the approver's role assignment must be in the
   *      SAME department as the item being approved. This was the
   *      documented-but-unenforced gap from TECH_DEBT #3.
   */
  async recordApproval(
    item: Approvable,
    progress: ApprovalProgress,
    approverId: string,
  ): Promise<WorkflowDecision> {
    if (item.requesterId === approverId) {
      throw new SelfApprovalNotAllowedError(item.id, approverId);
    }

    const alreadyApprovedByThisPerson = progress
      .getRecords()
      .some((r) => r.decision === 'approved' && r.approverId === approverId);
    if (alreadyApprovedByThisPerson) {
      throw new DuplicateApproverInChainError(item.id, approverId);
    }

    await this.assertHoldsCurrentStepRole(item, progress, approverId);

    return progress.recordApproval(approverId);
  }

  /**
   * Was previously synchronous with zero verification of its own — safe
   * ONLY because PermissionGuard's department-scoped grant was the sole
   * thing stopping a wrong-department approver from ever reaching this
   * method at all. That stopped being true the moment department_head's
   * expense:approve grant was broadened to organization scope (needed so
   * ANY department_head can fill a panel seat on someone else's
   * department's expense) — PermissionGuard now lets any department_head
   * reach this method for any item, so the role/department/self checks
   * that recordApproval() already had are added here too, not left to an
   * upstream gate that no longer covers this case. Async for the same
   * reason recordApproval() became async.
   */
  async recordRejection(
    item: Approvable,
    progress: ApprovalProgress,
    approverId: string,
    reason: string,
  ): Promise<void> {
    if (item.requesterId === approverId) {
      throw new SelfRejectionNotAllowedError(item.id, approverId);
    }

    await this.assertHoldsCurrentStepRole(item, progress, approverId);

    progress.recordRejection(approverId, reason);
  }

  private async assertHoldsCurrentStepRole(
    item: Approvable,
    progress: ApprovalProgress,
    approverId: string,
  ): Promise<void> {
    const step = progress.currentStepRequirement();
    if (!step) return;

    const approverRoles = await this.userRoleService.getRolesForUser(approverId);
    const holdsRequiredRole = approverRoles.some(
      (r) =>
        r.role === step.requiredRole &&
        (step.requiredScope !== 'department' || r.departmentId === item.departmentId),
    );
    if (!holdsRequiredRole) {
      throw new ApproverRoleMismatchError(approverId, step.requiredRole);
    }
  }
}
