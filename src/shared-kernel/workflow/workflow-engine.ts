// src/shared-kernel/workflow/workflow-engine.ts
import { Injectable } from '@nestjs/common';
import { Approvable } from './approvable';
import { ApprovalPolicy } from './approval-policy.port';
import { ApprovalProgress } from './approval-progress';
import { DomainError } from '../errors/domain-error';

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
/**
 * Orchestrates transitions; NEVER decides business rules itself (Phase 2.2).
 * Policy (who must approve, in what order) is injected per-context. This
 * class is intentionally thin — almost all the interesting logic already
 * lives in ApprovalChain/ApprovalProgress above, which is what makes it
 * safe to share across Expense and Payroll without either leaking into
 * the other.
 */
@Injectable()
export class WorkflowEngine {
  resolveChainFor(item: Approvable, policy: ApprovalPolicy) {
    return policy.resolveChain(item);
  }

  recordApproval(item: Approvable, progress: ApprovalProgress, approverId: string): WorkflowDecision {
    // Separation of Duties (Phase 9.1) enforced at the one chokepoint every
    // approval passes through — not left to role assignment alone.
    if (item.requesterId === approverId) {
      throw new SelfApprovalNotAllowedError(item.id, approverId);
    }
    return progress.recordApproval(approverId);
  }

  recordRejection(progress: ApprovalProgress, approverId: string, reason: string): void {
    progress.recordRejection(approverId, reason);
  }
}