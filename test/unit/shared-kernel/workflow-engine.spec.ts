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
import { RoleAssignment, UserRoleService } from '../../../src/shared-kernel/auth/user-role.port';
import { ApproverRoleMismatchError } from '../../../src/shared-kernel/errors/domain-error';
import { describe, it, expect, beforeEach } from '@jest/globals';

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

/** In-memory fake — maps approverId -> their role assignments, configured per test. */
class FakeUserRoleService implements UserRoleService {
  private roles = new Map<string, RoleAssignment[]>();

  setRoles(userId: string, roles: RoleAssignment[]): void {
    this.roles.set(userId, roles);
  }

  async getRolesForUser(userId: string): Promise<RoleAssignment[]> {
    return this.roles.get(userId) ?? [];
  }
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let fakeRoles: FakeUserRoleService;

  beforeEach(() => {
    fakeRoles = new FakeUserRoleService();
    engine = new WorkflowEngine(fakeRoles);
  });

  describe('recordApproval() — separation of duties', () => {
    it('throws SelfApprovalNotAllowedError when approver === requester', async () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      await expect(engine.recordApproval(item, progress, 'user-1')).rejects.toThrow(
        SelfApprovalNotAllowedError,
      );
    });
  });

  describe('recordApproval() — role verification (TECH_DEBT #3)', () => {
    it('throws ApproverRoleMismatchError when the approver lacks the required role', async () => {
      const item = buildApprovable({ requesterId: 'requester-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      fakeRoles.setRoles('wrong-role-user', [
        { role: 'employee', departmentId: null, organizationId: 'org-1' },
      ]);

      await expect(engine.recordApproval(item, progress, 'wrong-role-user')).rejects.toThrow(
        ApproverRoleMismatchError,
      );
    });

    it('throws ApproverRoleMismatchError when the approver has the right role but the WRONG department', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      fakeRoles.setRoles('dept-b-head', [
        { role: 'department_head', departmentId: 'dept-B', organizationId: 'org-1' },
      ]);

      await expect(engine.recordApproval(item, progress, 'dept-b-head')).rejects.toThrow(
        ApproverRoleMismatchError,
      );
    });

    it('succeeds when the approver has the right role AND the matching department', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      fakeRoles.setRoles('dept-a-head', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);
      await expect(engine.recordApproval(item, progress, 'dept-a-head')).resolves.toEqual({
        isFinalApproval: true,
      });
    });

    it('does not require department match for an organization-scoped step', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      // finance_director's departmentId is null (org-wide role) — should still pass
      fakeRoles.setRoles('fd-1', [
        { role: 'finance_director', departmentId: null, organizationId: 'org-1' },
      ]);

      await expect(engine.recordApproval(item, progress, 'fd-1')).resolves.toEqual({
        isFinalApproval: true,
      });
    });
  });

  describe('recordApproval() — multi-step chain completion', () => {
    it('reports isFinalApproval: false on a non-final step', async () => {
      const item = buildApprovable({ requesterId: 'user-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
        { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('dept-head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);

      const result = await engine.recordApproval(item, progress, 'dept-head-1');
      expect(result.isFinalApproval).toBe(false);
    });

    it('reports isFinalApproval: true on the last step', async () => {
      const item = buildApprovable({ requesterId: 'user-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
        { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('dept-head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);
      fakeRoles.setRoles('finance-director-1', [
        { role: 'finance_director', departmentId: null, organizationId: 'org-1' },
      ]);

      await engine.recordApproval(item, progress, 'dept-head-1');
      const result = await engine.recordApproval(item, progress, 'finance-director-1');
      expect(result.isFinalApproval).toBe(true);
    });

    it('throws NoSuchApprovalStepError when approving beyond the chain length', async () => {
      const item = buildApprovable({ requesterId: 'user-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('dept-head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);

      await engine.recordApproval(item, progress, 'dept-head-1');
      // No role check even reached here — currentStepRequirement() returns
      // null once the chain is exhausted, so the underlying
      // NoSuchApprovalStepError from ApprovalProgress fires as before.
      await expect(engine.recordApproval(item, progress, 'anyone-else')).rejects.toThrow(
        NoSuchApprovalStepError,
      );
    });
  });

  describe('recordRejection()', () => {
    it('records a rejection with a reason (unaffected by role-check changes — still sync)', () => {
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start('item-1', chain);

      engine.recordRejection(progress, 'dept-head-1', 'Missing receipt');
      const records = progress.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].decision).toBe('rejected');
    });
  });
});
