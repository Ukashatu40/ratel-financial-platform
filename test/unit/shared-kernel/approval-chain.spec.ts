// test/unit/shared-kernel/approval-chain.spec.ts
import { ApprovalChain } from '../../../src/shared-kernel/workflow/approval-chain';
import { describe, expect, it } from '@jest/globals';

describe('ApprovalChain', () => {
  it('empty() produces a zero-length chain', () => {
    const chain = ApprovalChain.empty();
    expect(chain.isEmpty()).toBe(true);
    expect(chain.length).toBe(0);
  });

  it('of() sorts steps by order regardless of input order', () => {
    const chain = ApprovalChain.of([
      { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
      { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
    ]);
    expect(chain.firstStep()?.requiredRole).toBe('department_head');
  });

  it('isLastStep() correctly identifies the final step in a multi-step chain', () => {
    const chain = ApprovalChain.of([
      { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
      { order: 2, requiredRole: 'finance_director', requiredScope: 'organization' },
    ]);
    expect(chain.isLastStep(1)).toBe(false);
    expect(chain.isLastStep(2)).toBe(true);
  });

  it('stepAt() returns null for a step order that does not exist', () => {
    const chain = ApprovalChain.of([
      { order: 1, requiredRole: 'department_head', requiredScope: 'department' },
    ]);
    expect(chain.stepAt(99)).toBeNull();
  });
});
