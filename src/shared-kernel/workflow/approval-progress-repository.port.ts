// src/shared-kernel/workflow/approval-progress-repository.port.ts
import { TransactionClient } from '../unit-of-work/unit-of-work.port';
import { ApprovalChain } from './approval-chain';
import { ApprovalProgress } from './approval-progress';

export interface ApprovalProgressRepository {
  initialize(itemId: string, itemType: string,  chain: ApprovalChain, tx: TransactionClient): Promise<ApprovalProgress>;
  findByItemId(itemId: string, tx?: TransactionClient): Promise<ApprovalProgress | null>;
  save(itemId: string, progress: ApprovalProgress, tx: TransactionClient): Promise<void>;
}

export const APPROVAL_PROGRESS_REPOSITORY = Symbol('APPROVAL_PROGRESS_REPOSITORY');