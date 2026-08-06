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

@Injectable()
export class WorkflowEngine {
  constructor(@Inject(USER_ROLE_SERVICE) private readonly userRoleService: UserRoleService) {}

  resolveChainFor(item: Approvable, policy: ApprovalPolicy) {
    return policy.resolveChain(item);
  }

  /**
   * Now async — this is the one call-site change every consumer (Expense's
   * and Payroll's approve handlers) needs to pick up with `await`. Two
   * checks now run, in order:
   *   1. Separation of duties: requester !== approver (unchanged).
   *   2. Role correctness: the approver must actually hold the role
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

    const step = progress.currentStepRequirement();
    if (step) {
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

    return progress.recordApproval(approverId);
  }

  recordRejection(progress: ApprovalProgress, approverId: string, reason: string): void {
    progress.recordRejection(approverId, reason);
  }
}
