// src/shared-kernel/workflow/approval-chain.ts
export interface ApprovalStep {
  readonly order: number;
  readonly requiredRole: string; // e.g. 'department_head', 'finance_director'
  readonly requiredScope: 'department' | 'organization';
}

export class ApprovalChain {
  private constructor(private readonly steps: ApprovalStep[]) {}

  static of(steps: ApprovalStep[]): ApprovalChain {
    const sorted = [...steps].sort((a, b) => a.order - b.order);
    return new ApprovalChain(sorted);
  }

  static empty(): ApprovalChain {
    // Represents "no approval required" — e.g. auto-approved adjustments
    return new ApprovalChain([]);
  }

  get length(): number {
    return this.steps.length;
  }

  isEmpty(): boolean {
    return this.steps.length === 0;
  }

  firstStep(): ApprovalStep | null {
    return this.steps[0] ?? null;
  }

  stepAt(order: number): ApprovalStep | null {
    return this.steps.find((s) => s.order === order) ?? null;
  }

  isLastStep(order: number): boolean {
    const max = Math.max(...this.steps.map((s) => s.order));
    return order === max;
  }

  toArray(): readonly ApprovalStep[] {
    return this.steps;
  }
}
