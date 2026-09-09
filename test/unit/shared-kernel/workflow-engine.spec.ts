// test/unit/shared-kernel/workflow-engine.spec.ts
import {
  WorkflowEngine,
  SelfApprovalNotAllowedError,
  SelfRejectionNotAllowedError,
  DuplicateApproverInChainError,
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

  describe('recordApproval() — chain-wide duplicate-approver check', () => {
    it('throws DuplicateApproverInChainError when the same person already approved an EARLIER step, even non-consecutively', async () => {
      // 3-seat panel, all requiring the same role/scope — exactly
      // ExpenseApprovalPolicy's department_head panel shape. Same person
      // fills seat 1, a different person fills seat 2, then the SAME
      // person as seat 1 tries to fill seat 3 — not consecutive with their
      // own first approval, so a "no repeat at consecutive steps" check
      // would miss this; the chain-wide check must not.
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'organization' },
        { order: 2, requiredRole: 'department_head', requiredScope: 'organization' },
        { order: 3, requiredRole: 'department_head', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      fakeRoles.setRoles('head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);
      fakeRoles.setRoles('head-2', [
        { role: 'department_head', departmentId: 'dept-B', organizationId: 'org-1' },
      ]);

      await engine.recordApproval(item, progress, 'head-1');
      await engine.recordApproval(item, progress, 'head-2');

      await expect(engine.recordApproval(item, progress, 'head-1')).rejects.toThrow(
        DuplicateApproverInChainError,
      );
    });

    it('succeeds when three DIFFERENT approvers each fill one seat of the panel', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'organization' },
        { order: 2, requiredRole: 'department_head', requiredScope: 'organization' },
        { order: 3, requiredRole: 'department_head', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      for (const id of ['head-1', 'head-2', 'head-3']) {
        fakeRoles.setRoles(id, [
          { role: 'department_head', departmentId: `dept-${id}`, organizationId: 'org-1' },
        ]);
      }

      await engine.recordApproval(item, progress, 'head-1');
      await engine.recordApproval(item, progress, 'head-2');
      const result = await engine.recordApproval(item, progress, 'head-3');

      expect(result.isFinalApproval).toBe(true);
    });

    it('does not falsely trigger on a REJECTED prior record from the same person', async () => {
      // A rejection isn't an approval — pins that the check specifically
      // filters on decision === 'approved'. A 2-step chain so the step
      // after the rejected one is genuinely still live (on a 1-step chain,
      // currentStepOrder() would already be past the end regardless, for
      // an unrelated reason — NoSuchApprovalStepError, not this check).
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'organization' },
        { order: 2, requiredRole: 'department_head', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);
      await engine.recordRejection(item, progress, 'head-1', 'not this time');

      await expect(engine.recordApproval(item, progress, 'head-1')).resolves.toBeDefined();
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
    // Now async with its own verification, mirroring recordApproval() —
    // previously synchronous with NO checks at all, safe only because
    // PermissionGuard's (now-broadened) department-scoped grant used to be
    // the sole thing stopping a wrong-department rejection.
    it('records a rejection with a reason when the rejecter holds the required role', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('dept-head-1', [
        { role: 'department_head', departmentId: 'dept-A', organizationId: 'org-1' },
      ]);

      await engine.recordRejection(item, progress, 'dept-head-1', 'Missing receipt');
      const records = progress.getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].decision).toBe('rejected');
    });

    it('throws SelfRejectionNotAllowedError when rejecter === requester', async () => {
      const item = buildApprovable({ requesterId: 'user-1' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);

      await expect(engine.recordRejection(item, progress, 'user-1', 'changed my mind')).rejects.toThrow(
        SelfRejectionNotAllowedError,
      );
    });

    it('throws ApproverRoleMismatchError when the rejecter lacks the required role', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('wrong-role-user', [
        { role: 'employee', departmentId: null, organizationId: 'org-1' },
      ]);

      await expect(
        engine.recordRejection(item, progress, 'wrong-role-user', 'not my call'),
      ).rejects.toThrow(ApproverRoleMismatchError);
    });

    it('throws ApproverRoleMismatchError when the rejecter has the right role but the WRONG department — the gap this exposed', async () => {
      // The scenario recordRejection() previously had NO defense against
      // once department_head's PermissionGuard grant became organization-
      // scoped: a department_head from the WRONG department reaching this
      // method at all. This is the regression test for that fix.
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('dept-b-head', [
        { role: 'department_head', departmentId: 'dept-B', organizationId: 'org-1' },
      ]);

      await expect(
        engine.recordRejection(item, progress, 'dept-b-head', 'not my department'),
      ).rejects.toThrow(ApproverRoleMismatchError);

      expect(progress.getRecords()).toHaveLength(0);
    });

    it('does not require department match for an organization-scoped step', async () => {
      const item = buildApprovable({ requesterId: 'requester-1', departmentId: 'dept-A' });
      const chain = ApprovalChain.of([
        { order: 1, requiredRole: 'finance_director', requiredScope: 'organization' },
      ]);
      const progress = ApprovalProgress.start(item.id, chain);
      fakeRoles.setRoles('fd-1', [
        { role: 'finance_director', departmentId: null, organizationId: 'org-1' },
      ]);

      await engine.recordRejection(item, progress, 'fd-1', 'budget concerns');
      expect(progress.getRecords()).toHaveLength(1);
    });
  });
});
