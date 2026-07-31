// src/shared-kernel/workflow/approvable.ts
/**
 * Anything with an approval-gated lifecycle implements this — Expense today,
 * PayrollRun later (Phase 2.2/2.4). The WorkflowEngine only ever talks to
 * this interface, never to Expense or PayrollRun directly, which is what
 * makes the framework genuinely reusable rather than accidentally
 * Expense-shaped.
 */
export interface Approvable {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId?: string;
  readonly requesterId: string;
  readonly amountMinorUnits: bigint;
}