// test/unit/shared-kernel/workflow-engine.spec.ts
import {
  WorkflowEngine,
  SelfApprovalNotAllowedError,
} from '../../../src/shared-kernel/workflow/workflow-engine';
import { ApprovalChain } from '../../../src/shared-kernel/workflow/approval-chain';
import {
  ApprovalProgress,
  NoSuchApprovalStepError,
} from '../../../src/shared-kernel/workflow/approval-progress';
import { Approvable } from '../../../src/shared-kernel/workflow/approvable';
import { describe, expect, it, beforeEach } from '@jest/globals';

function buildApprovable(overrides: Partial<Approvable> = {}): Approvable {
  return {
    id: 'item-1',
    organizationId: 'org-1',
    departmentId: 'dept-1',
    requesterId: 'requester-1',
    amountMinorUnits: 10000n,
    ...overrides,
  };
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  describe('recordApproval() — separation of duties', () => {
    it('throws SelfApprovalNotAllowedError when approver === requester', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      expect(() => engine.recordApproval(item, progress, 'user-1')).toThrow(
        SelfApprovalNotAllowedError,
      );
    });

    it('allows approval from a different user', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      expect(() => engine.recordApproval(item, progress, 'approver-1')).not.toThrow();
    });
  });

  describe('recordApproval() — multi-step chain completion', () => {
    it('reports isFinalApproval: false on a non-final step', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
        { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      const result = engine.recordApproval(item, progress, 'dept-head-1');
      expect(result.isFinalApproval).toBe(false);
    });

    it('reports isFinalApproval: true on the last step', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
        { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      engine.recordApproval(item, progress, 'dept-head-1');
      const result = engine.recordApproval(item, progress, 'finance-director-1');
      expect(result.isFinalApproval).toBe(true);
    });

    it('reports isFinalApproval: true immediately for a single-step chain', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      const result = engine.recordApproval(item, progress, 'dept-head-1');
      expect(result.isFinalApproval).toBe(true);
    });

    it('throws NoSuchApprovalStepError when approving beyond the chain length', () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      engine.recordApproval(item, progress, 'dept-head-1');
      expect(() => engine.recordApproval(item, progress, 'someone-else')).toThrow(
        NoSuchApprovalStepError,
      );
    });
  });

  describe('recordRejection()', () => {
    it('records a rejection with a reason', () => {
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start('item-1', chain);

      engine.recordRejection(progress, 'dept-head-1', 'Missing receipt');
      const records = progress.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].decision).toBe('rejected');
      expect(records[0].reason).toBe('Missing receipt');
    });
  });
});
