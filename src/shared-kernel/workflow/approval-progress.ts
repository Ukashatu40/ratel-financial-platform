// src/shared-kernel/workflow/approval-progress.ts
import { ApprovalChain } from "./approval-chain";
import { DomainError } from '../errors/domain-error';

export interface ApprovalRecord {
  stepOrder: number;
  approverId: string;
  decidedAt: Date;
  decision: 'approved' | 'rejected';
  reason?: string;
}

export class ApprovalProgress {
  private constructor(
    private readonly itemId: string,
    private readonly chain: ApprovalChain,
    private records: ApprovalRecord[],
  ) {}

  static start(itemId: string, chain: ApprovalChain): ApprovalProgress {
    return new ApprovalProgress(itemId, chain, []);
  }

  static reconstitute(itemId: string, chain: ApprovalChain, records: ApprovalRecord[]): ApprovalProgress {
    return new ApprovalProgress(itemId, chain, records);
  }

  currentStepOrder(): number {
    return this.records.length + 1;
  }

  recordApproval(approverId: string): { isFinalApproval: boolean } {
    const stepOrder = this.currentStepOrder();
    const step = this.chain.stepAt(stepOrder);
    if (!step) {
      throw new NoSuchApprovalStepError(this.itemId, stepOrder);
    }
    this.records.push({ stepOrder, approverId, decidedAt: new Date(), decision: 'approved' });
    return { isFinalApproval: this.chain.isLastStep(stepOrder) };
  }

  recordRejection(approverId: string, reason: string): void {
    const stepOrder = this.currentStepOrder();
    this.records.push({ stepOrder, approverId, decidedAt: new Date(), decision: 'rejected', reason });
  }

  getRecords(): readonly ApprovalRecord[] {
    return this.records;
  }
}

export class NoSuchApprovalStepError extends DomainError {
  readonly code = 'no-such-approval-step';
  readonly httpStatus = 409;

  constructor(itemId: string, stepOrder: number) {
    super(`No approval step ${stepOrder} defined for item ${itemId} — chain is shorter than expected`);
  }
}