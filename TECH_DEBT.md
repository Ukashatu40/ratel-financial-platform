# Technical Debt & Known Simplifications

This document tracks deliberate simplifications, deferred work, and known gaps
introduced during the build of `ratel-financial-platform`. Each entry was
flagged explicitly at the point it was introduced rather than silently shipped
— this file exists so none of them get forgotten once they're no longer fresh
in conversation.

Entries are grouped by area, each with: what the gap is, why it was
acceptable at the time, and what closing it properly would require.

---

## Security / Authentication / Authorization

### 1. ~~Every actor ID is a hardcoded placeholder~~ — RESOLVED
Auth module built (JWT, `@CurrentUser()`); every `PLACEHOLDER_*_ID` across
`FinancialPeriodController`, `ExpenseController`, `PayrollRunController`
replaced with `@CurrentUser()`. `organizationId` also removed from every
request DTO and now derives exclusively from the authenticated principal,
closing the cross-org spoofing surface at the source rather than detecting
it after the fact.

### 2. ~~`@RequirePermission` guard is commented out everywhere~~ — RESOLVED
`PermissionGuard` + `@RequirePermission` built and wired on every mutating
endpoint across all three controllers, backed by the real `role_permissions`
table and seed data. See #3 below for what this guard does NOT yet enforce.

### 3. `PermissionGuard` and `WorkflowEngine` don't verify resource-level scope
**Where:** `src/auth/authorization/permission.guard.ts`,
`src/shared-kernel/workflow/workflow-engine.ts`
**What:** Two related, still-open gaps:
- `PermissionGuard` checks that a user holds SOME role granting the required
  permission, and that the request's implicit org matches the user's own —
  but does NOT verify department-level match (e.g. a `department_head` can
  currently approve expenses from ANY department, not just their own,
  despite routes being annotated `{ scope: 'department' }`). That scope
  argument currently documents intent without being enforced.
- `WorkflowEngine.recordApproval()` checks self-approval (separation of
  duties) but does NOT verify the approver's role actually matches the
  current `ApprovalStep.requiredRole` — e.g. an `employee` role, if it
  somehow ended up calling `expense:approve` successfully, would still pass
  `WorkflowEngine`'s own check.
**Why acceptable so far:** No endpoint currently allows a user to act
outside their assigned department in a way that's been tested; the gap is
real but narrower in practice than it sounds, since seed data assigns each
test user exactly one relevant role.
**To close:** `PermissionGuard` needs each route to supply a resource-loader
(fetch the target expense/payroll run, compare its `departmentId`/org
against the user's assignment) before allowing the request through.
`WorkflowEngine` needs a `UserRoleService` port to check the approver's role
against `ApprovalStep.requiredRole` directly. Both are real, scoped pieces
of work — not a rewrite — deferred here to keep the auth module's initial
build focused on getting the mechanics (JWT, permission matrix, guard
skeleton) correct first.

### 4. `audit_log_entries` append-only DB grant not applied
**Where:** Migration for `add_outbox_context_and_audit_log`, commented out.
**What:** Phase 6.2 specified `REVOKE UPDATE, DELETE ON audit_log_entries
FROM application_role` so even a compromised app can't rewrite history. No
`application_role` exists in the local dev DB (connecting as `postgres`
superuser), so this was left commented rather than failing the migration.
**To close:** Create a real least-privilege DB role as part of Phase 10
(Infrastructure/deployment), grant it only what the app needs, apply this
REVOKE for real.

### 5. Field encryption master key sourced from plain env var
**Where:** `AesGcmEnvelopeEncryptionService`, `FIELD_ENCRYPTION_MASTER_KEY`.
**What:** The KEK is read directly from an environment variable — fine for
local dev, but Phase 9.4 specified real KMS/Vault-backed key management for
production, with rotation support.
**To close:** Swap `loadKekFromBase64(config.get(...))` for a real KMS client
call. The pure-function crypto core (`aes-gcm-envelope-crypto.ts`) was
deliberately built KEK-source-agnostic, so this should be a contained change.

---

## Audit Trail

### 6. Hash chain read-then-write is not atomic
**Where:** `AuditLogService.record()`
**What:** Reads the last entry's hash, then inserts a new row, as two
separate statements. Under concurrent writers, two entries could read the
same `prevHash` and race, corrupting the chain's integrity.
**Why acceptable so far:** The outbox dispatcher currently runs as a single
instance processing events sequentially (one at a time, in a loop) — no
concurrent writers exist yet.
**To close:** Either wrap the read+insert in a Postgres advisory lock, or
move hash computation into a DB trigger (as Phase 6.2 originally specified).
Must be fixed before running more than one dispatcher instance.

### 7. No field-level old/new value diffing
**Where:** `AuditSubscriber`
**What:** Captures each domain event's full payload as `newValue`; does not
compute or store a genuine before/after diff of specific fields on direct
edits. This is event-sourced-style audit (full history reconstructible from
events), which satisfies "never lose history," but is not the same guarantee
as literal per-field old/new values implied by the original schema design.
**To close:** Would require every mutating aggregate method to capture and
pass forward an explicit diff — a materially larger change touching every
aggregate, not just the audit subscriber.

### 8. Failed event delivery to one subscriber is only logged, not retried
**Where:** `DomainEventDispatcher.dispatch()`
**What:** Uses `Promise.allSettled` across handlers so one failing subscriber
doesn't block others — but a failed subscriber's failure is only logged, not
retried or sent to a dead-letter queue. If Audit's DB write fails
transiently, that audit entry is silently lost.
**To close:** Apply the same DLQ pattern already designed for the Integration
Layer (Phase 8.3) to per-subscriber dispatch failures.

---

## Domain / Business Logic

### 9. `createAdjustment` re-approval threshold is a guess, not confirmed policy
**Where:** `ExpenseAdjustmentApprovalPolicy`
**What:** ₦1,000,000 threshold for requiring re-approval on an adjustment was
chosen as "higher than the finance-director threshold" reasoning, not a
number Ratel-Plus actually specified.
**To close:** Confirm the real policy and adjust the constant.

### 10. `PayrollRun.reject()` returns to `draft`, not a terminal `rejected` state
**Where:** `PayrollRun` aggregate.
**What:** Deliberate design choice (confirmed with you) — differs from
Expense's terminal `rejected` status. Documented here only so the asymmetry
between the two contexts isn't mistaken for an inconsistency bug later.

### 11. `ExpenseController.adjust()` throws — organizationId resolution unresolved
**Where:** `ExpenseController`, the `POST /:id/adjustments` endpoint.
**What:** Deliberately left throwing rather than accepting `organizationId`
from the request body (a security gap — should come from the authenticated
user's own org membership, not client-supplied input).
**To close:** Wire once `@CurrentUser()` exists (same blocker as #1).

### 12. `ProcessPayrollRunHandler` does not perform real disbursement
**Where:** `ProcessPayrollRunHandler`
**What:** Flips `PayrollRun` state (`approved → processing → completed`)
synchronously with no actual bank transfer / payment gateway integration.
**To close:** Build as a real BullMQ job once a disbursement provider is
chosen, per the original blueprint's `jobs/processors/` design.

---

## Data Integrity

### 17. `UserRoleAssignment`'s compound unique doesn't fully hold with nullable `departmentId`
**Where:** `@@unique([userId, role, departmentId])` on `UserRoleAssignment`.
**What:** Postgres treats every `NULL` as distinct within a unique index, so
this constraint does NOT prevent two rows with the same `(userId, role,
null)` — i.e. duplicate org-scoped role assignments (any role other than
`department_head`) could be inserted without violating the DB constraint.
Discovered via a TS2322 error in the seed script when trying to build a
compound-unique `where` clause including `null` — Prisma's generated typing
surfaced the underlying semantic gap.
**Why acceptable so far:** Seed script now works around it with a manual
`findFirst`-then-`create` check instead of relying on the constraint;
duplicate assignments are merely redundant today; no real user-facing
mutation path creates `UserRoleAssignment` rows yet (only the seed script
does).
**To close:** Either (a) use a non-null sentinel value for org-scoped roles'
`departmentId` instead of `null` — e.g. reference the organization's own ID
as a placeholder — or (b) split into two tables (`DepartmentRoleAssignment`
vs `OrganizationRoleAssignment`) so the unique constraint doesn't need a
nullable column at all. Must be fixed before any endpoint allows users to
self-assign or admins to assign roles through the API — right now it's a
seed-only quirk with no production exposure.

## Performance

### 13. `expenses` table is not actually partitioned
**Where:** Prisma migration for the Expense context.
**What:** Phase 6.2 specified range partitioning by `expense_date` for scale.
The composite PK `(id, expenseDate)` was added in anticipation, but the
actual `PARTITION BY RANGE` DDL was deliberately deferred — Prisma's
migration diffing doesn't understand native partitioning and would fight it
on every subsequent `migrate dev`.
**To close:** Hand-written migration, done once volume actually justifies it
(Phase 6.2's original reasoning still applies).

### 14. Payroll run reads decrypt every payslip individually
**Where:** `PrismaPayrollRunRepository.findById` / `findByOrgAndMonth`
**What:** N decryption calls per read (one per payslip in the run) — fine at
current volume, will matter once runs have hundreds of employees.
**To close:** Revisit under Phase 12 (Performance) once real load exists.

---

## Dependency Management

### 15. TypeScript pinned to 5.9.3, not latest (7.0.2 at time of writing)
**Where:** `package.json` devDependencies.
**Why:** TS7 is a very recent major version jump; NestJS 11's decorator
metadata pipeline and `ts-jest` compatibility weren't confirmed. Revisit in
isolation once the ecosystem catches up.

### 16. `bullmq` pinned to 5.81.3, `ioredis` pinned to 5.11.1
**Where:** `package.json` dependencies.
**Why:** `bullmq@6.x` and `ioredis@6.x` were published within days of this
build and are NOT within `@nestjs/bullmq@11.0.4`'s declared peer range
(`bullmq: ^3.0.0 || ^4.0.0 || ^5.0.0`). Revisit both majors together once
`@nestjs/bullmq` publishes support.

---

*Last updated: 2026-08-02, after the Audit subscriber piece (M3 follow-on).*