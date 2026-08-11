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

### 3. ~~`PermissionGuard` and `WorkflowEngine` don't verify resource-level scope~~ — RESOLVED
Both gaps closed:
- `PermissionGuard` now reads the ACTUAL granted scope from `role_permissions`
  (not a decorator argument that could drift from what's seeded) and, for
  `own`/`department` grants, resolves the target resource via a
  `ResourceScopeRegistry` (self-registration pattern, mirroring
  `AuditSubscriber`) to check requester/department match. The
  `@RequirePermission` decorator's `scope` argument was removed entirely —
  it was never enforced, and keeping a decorative parameter that looked
  load-bearing was worse than not having it.
- `WorkflowEngine.recordApproval()` is now async and verifies the approver
  actually holds `ApprovalStep.requiredRole` (and matching department, for
  department-scoped steps) via a new `UserRoleService` port, before
  delegating to `ApprovalProgress`.
- Regression-tested: `WorkflowEngine`'s role verification has 4 new unit
  tests (wrong role, right role/wrong department, right role/right
  department, org-scope skip). `PermissionGuard`'s resource-scope path is
  not yet covered by a dedicated test — worth adding before relying on it
  further (see new item below).

### 3b. ~~`PermissionGuard`'s resource-scope enforcement lacks dedicated test coverage~~ — RESOLVED
Added two e2e tests: a department_head from Department B is denied (403)
approving an expense in Department A, and the same department's own head
is allowed (201) — the positive-case control confirming the guard isn't
just blocking everything indiscriminately.

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

### 6. `principal.organizationId` is derived from `roleAssignments[0]`, arbitrarily
**Where:** `AuthService.login()`, `AuthService.refresh()`
**What:** The JWT's `organizationId` claim is taken from the FIRST role
assignment row returned for the user (`user.roleAssignments[0].organizationId`),
with no explicit ordering guarantee on that query. Under today's confirmed
single-tenant assumption (only Ratel-Plus Nigeria Ltd exists — Phase 1.3),
every role assignment for every seeded user has the same `organizationId`
regardless, so this is harmless in practice right now.
**Why acceptable so far:** No user in the system currently holds roles
across more than one organization, since only one organization exists.
**To close:** The moment multi-organization support becomes real (Phase 1's
explicit future-capability), this silently breaks: a user with roles in two
orgs would get logged into whichever org's role happened to be first in an
unordered query result — not necessarily the org they intended to act in.
Proper fix requires either (a) an explicit "which organization are you
logging into" selection at login time when a user has multi-org roles, or
(b) a separate token-issuance step per organization context, chosen
explicitly rather than inferred. Flagged at the point `AuthService` was
built rather than left implicit — this is a design gap to revisit
deliberately when multi-tenancy work actually begins, not a bug to patch
reactively later.

---

## Audit Trail

### 7. ~~Hash chain read-then-write is not atomic~~ — RESOLVED
Fixed via a Postgres advisory lock (`pg_advisory_xact_lock`, transaction-scoped
— auto-releases at commit/rollback) wrapping the read-then-insert inside
`AuditLogService.record()`, serializing every concurrent writer globally.
`AuditLogService` now goes through `UnitOfWork` instead of holding a direct
`PrismaService` reference, consistent with the rest of the codebase's
transaction pattern.

Verified with a real integration test (not just unit-tested, since a fake
transaction client can't prove anything about actual Postgres-level
serialization): 20 genuinely concurrent `record()` calls via `Promise.all`
produce an unbroken chain — every entry's `prevHash` matches the previous
entry's `entryHash` exactly, and all 20 `entryHash` values are unique. This
is the scenario that would have reliably corrupted the chain before the fix.

### 7b. Audit chain is a single global sequence across all organizations, not per-organization
**Where:** `AuditLogService.record()` — the `findFirst({ orderBy: {
createdAt: 'desc' } })` query has no `organizationId` filter, so it walks
the LATEST entry across every organization, not the latest entry for the
specific org being audited.
**What:** Discovered while fixing #7, deliberately NOT changed as part of
that fix since it's a different concern (chain scope, not atomicity) —
changing it would be a bigger design decision than what #7 asked for.
Today, with only one organization (Ratel-Plus) existing, this is invisible.
The moment a second organization exists, every organization's audit entries
interleave into ONE shared chain — which means proving chain integrity to
one organization's auditor would necessarily expose that other
organizations' events participated in the same sequence, a real disclosure
concern, not just a cosmetic one.
**To close:** Decide deliberately whether the chain should be scoped
per-organization (separate `prevHash` lineage per `organizationId`, likely
the right call once multi-tenancy is real) or intentionally kept global
(defensible only if a documented reason exists, e.g. a single shared
compliance boundary). Whichever is chosen, the advisory lock key from #7's
fix would need to become per-organization too
(`hashtext('audit_log_chain:' || organizationId)`) rather than the current
single global key, to avoid serializing unrelated organizations' writes
against each other unnecessarily.

### 8. No field-level old/new value diffing
**Where:** `AuditSubscriber`
**What:** Captures each domain event's full payload as `newValue`; does not
compute or store a genuine before/after diff of specific fields on direct
edits. This is event-sourced-style audit (full history reconstructible from
events), which satisfies "never lose history," but is not the same guarantee
as literal per-field old/new values implied by the original schema design.
**To close:** Would require every mutating aggregate method to capture and
pass forward an explicit diff — a materially larger change touching every
aggregate, not just the audit subscriber.

### 9. Failed event delivery to one subscriber is only logged, not retried
**Where:** `DomainEventDispatcher.dispatch()`
**What:** Uses `Promise.allSettled` across handlers so one failing subscriber
doesn't block others — but a failed subscriber's failure is only logged, not
retried or sent to a dead-letter queue. If Audit's DB write fails
transiently, that audit entry is silently lost.
**To close:** Apply the same DLQ pattern already designed for the Integration
Layer (Phase 8.3) to per-subscriber dispatch failures.

---

## Domain / Business Logic

### 10. `createAdjustment` re-approval threshold is a guess, not confirmed policy
**Where:** `ExpenseAdjustmentApprovalPolicy`
**What:** ₦1,000,000 threshold for requiring re-approval on an adjustment was
chosen as "higher than the finance-director threshold" reasoning, not a
number Ratel-Plus actually specified.
**To close:** Confirm the real policy and adjust the constant.

### 11. `PayrollRun.reject()` returns to `draft`, not a terminal `rejected` state
**Where:** `PayrollRun` aggregate.
**What:** Deliberate design choice (confirmed with you) — differs from
Expense's terminal `rejected` status. Documented here only so the asymmetry
between the two contexts isn't mistaken for an inconsistency bug later.

### 12. ~~`ExpenseController.adjust()` throws~~ — RESOLVED
Resolved alongside item #1 — `organizationId` now derives from
`@CurrentUser().organizationId` rather than the request body, and the
endpoint no longer throws a placeholder error.

### 13. `ProcessPayrollRunHandler` does not perform real disbursement
**Where:** `ProcessPayrollRunHandler`
**What:** Flips `PayrollRun` state (`approved → processing → completed`)
synchronously with no actual bank transfer / payment gateway integration.
**To close:** Build as a real BullMQ job once a disbursement provider is
chosen, per the original blueprint's `jobs/processors/` design.

---

### 19. Prisma 7 requires driver adapters; every raw `pg.Pool` needs an `error` listener
**Where:** `src/prisma/prisma.service.ts`, `prisma/seed/seed.ts`,
`test/integration/setup/db-helper.ts` — anywhere a `PrismaClient` is
constructed.
**What:** Two related, discovered-together facts about this codebase's
actual Prisma 7 setup:
1. Prisma 7 removed the Rust query engine binary; `PrismaClientOptions` no
   longer accepts a `datasourceUrl` string override. Every `PrismaClient`
   construction now goes through a `@prisma/adapter-pg` wrapping a
   manually-constructed `pg.Pool` — confirmed necessary project-wide (test
   helper, `PrismaService`, and the seed script all needed this), not a
   test-only workaround.
2. `node-postgres` (`pg`) requires an explicit `.on('error', ...)` listener
   on every `Pool` instance. Without one, a pooled client losing its
   connection (network blip, DB restart, or — as discovered via the
   integration test harness — a Testcontainers-managed Postgres being
   stopped while a client still held a connection) emits an unhandled
   `'error'` event that crashes the entire Node process, not just the one
   affected query.
**Why acceptable so far:** The integration and e2e test harnesses both got
fixed with a `pool.on('error', ...)` listener at the point this was
discovered, and the e2e suite (login → create → submit → approve, plus
audit trail verification) now passes cleanly end-to-end against real
Postgres + Redis containers, confirming the pattern works.
**To close:** `PrismaService`'s `pool.on('error', ...)` handler currently
mirrors the TEST harness's pattern exactly (silently swallowing
`'terminating connection'`/`57P01` with no log at all) — this is the wrong
choice for production code specifically. A live connection termination is
meaningful operational signal (DB restart, network partition, pool
exhaustion, ops action) that should always be logged, just at a lower
severity for this expected-during-restart case vs. `error` severity for
anything else. The test harness's silent-swallow is fine because we
control exactly why/when it fires there; `PrismaService` needs the same
listener structure but with logging retained for every branch, never a
fully silent case.

### 20. ~~No `GET` endpoints exist on `ExpenseController` or `PayrollRunController`~~ — RESOLVED
Built `GET /:id` and `GET /` (cursor-paginated) for both controllers.
Expense's list endpoint scopes results via a new `EffectiveScopeResolver`
(widest granted scope becomes a query filter — `own` filters by requester,
`department` by department IDs, `organization` applies no filter). Payroll's
endpoints need no equivalent scoping since every payroll permission is
organization-scoped only. See new item #21 for a design choice made while
building this that's worth flagging on its own.

### 21. Payroll's GET :id response is shaped for a two-tier view split that isn't actually enforced
**Where:** `GetPayrollRunByIdHandler`
**What:** The handler's response deliberately omits the decrypted
line-item breakdown (only returns `employeeId`/`grossPay`/`netPay` per
payslip), with a comment implying this is a lighter "summary" view distinct
from full sensitive detail. In reality, BOTH this summary and any future
full-detail endpoint currently sit behind the exact same permission
(`payroll:view_sensitive`) — there's no actual two-tier authorization here,
just a response shape that looks like there might be one day.
**To close:** Either commit to the two-tier design for real (a separate,
more restrictive permission for full line-item detail vs. this summary), or
simplify the response/comment to stop implying a distinction that isn't
enforced. Low priority — not a security gap (the single permission gate is
still correctly enforced), just a piece of code whose shape overstates its
own behavior.

## Data Integrity

### 14. `UserRoleAssignment`'s compound unique doesn't fully hold with nullable `departmentId`
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

### 15. `expenses` table is not actually partitioned
**Where:** Prisma migration for the Expense context.
**What:** Phase 6.2 specified range partitioning by `expense_date` for scale.
The composite PK `(id, expenseDate)` was added in anticipation, but the
actual `PARTITION BY RANGE` DDL was deliberately deferred — Prisma's
migration diffing doesn't understand native partitioning and would fight it
on every subsequent `migrate dev`.
**To close:** Hand-written migration, done once volume actually justifies it
(Phase 6.2's original reasoning still applies).

### 16. Payroll run reads decrypt every payslip individually
**Where:** `PrismaPayrollRunRepository.findById` / `findByOrgAndMonth`
**What:** N decryption calls per read (one per payslip in the run) — fine at
current volume, will matter once runs have hundreds of employees.
**To close:** Revisit under Phase 12 (Performance) once real load exists.

---

## Dependency Management

### 17. TypeScript pinned to 5.9.3, not latest (7.0.2 at time of writing)
**Where:** `package.json` devDependencies.
**Why:** TS7 is a very recent major version jump; NestJS 11's decorator
metadata pipeline and `ts-jest` compatibility weren't confirmed. Revisit in
isolation once the ecosystem catches up.

### 18. `bullmq` pinned to 5.81.3, `ioredis` pinned to 5.11.1
**Where:** `package.json` dependencies.
**Why:** `bullmq@6.x` and `ioredis@6.x` were published within days of this
build and are NOT within `@nestjs/bullmq@11.0.4`'s declared peer range
(`bullmq: ^3.0.0 || ^4.0.0 || ^5.0.0`). Revisit both majors together once
`@nestjs/bullmq` publishes support.

## Integration Layer

### 22. CSV import uses a fixed column schema, not configurable mapping
**Where:** `src/integration/adapters/csv/csv-provider.adapter.ts`
**What:** Phase 8.2 originally envisioned user-configurable header mapping
(real-world spreadsheets vary in column names/order). v1 requires an exact
fixed header set (`department,category,vendor,amountMinorUnits,currency,
expenseDate,description`) — anything else fails the whole file at parse
time with a clear error, but there's no mapping UI/config to adapt to a
different layout.
**To close:** Build a `ColumnMapping` concept (per-upload, stored config
mapping arbitrary source headers to the canonical fields) — genuinely
separate, larger scope from what this piece built.

### 23. ~~Import CSV content is stored in the database, not object storage~~ — RESOLVED
`ImportJob.rawContent TEXT` replaced with `storageKey`, pointing at the
file in the same object storage now used for expense attachments.
`ImportController` uploads to storage before creating the DB row (same
upload-first-then-persist ordering as `AttachFileHandler`); `ImportJobProcessor`
fetches the file via the new `ObjectStoragePort.download()` method instead
of reading a DB column. One accepted new failure mode worth noting: import
processing now depends on object storage being reachable, which it didn't
before — a reasonable trade for closing the original gap, not a regression
introduced silently.

### 24. ~~File upload has no dedicated 400 for "no file provided"~~ — RESOLVED
Fixed in both `ImportController.create()` and `ExpenseController.attach()`
(`throw new Error(...)` → `throw new BadRequestException(...)`). Also
caught and fixed the same underlying bug class in `AttachFileHandler`:
`UnsupportedFileTypeError` and `FileTooLargeError` were plain `Error`
subclasses, invisible to `ProblemDetailsFilter`, so they surfaced as 500s
too — converted both to `DomainError` subclasses (400) alongside this fix,
since it's the identical root cause. Verified via e2e: unsupported file
type now returns 400, not 500.

### 25. No file-type/content validation on CSV upload
**Where:** `ImportController.create()`
**What:** Accepts any uploaded file as if it were CSV — no MIME-type check,
no content-sniffing (Phase 9.7's "secure file uploads" guidance). A
non-CSV file just fails at parse time with a generic error, which is safe
but not a great experience, and doesn't address the security-adjacent
concern of blindly trusting client-declared file type.
**To close:** Add content-sniffing validation before attempting to parse.

---

## Object Storage

### 26. No real virus scanning — attachments default to "unscanned," not actually checked
**Where:** `AttachFileHandler`, `Attachment.scanStatus`
**What:** Phase 9.7 specified secure file uploads with virus scanning
(ClamAV or a hosted scanning service) before a file becomes visible/
downloadable. This build persists every upload with `scanStatus: 'unscanned'`
and does NOT run any actual scan, nor does anything gate download access
on scan status — an infected file uploaded today would be immediately
downloadable by anyone with view access to the expense.
**Why acceptable so far:** No scanning integration exists anywhere in this
codebase; being honest about that via an explicit `unscanned` status
(rather than a misleading `clean` default) was the deliberate choice made
when this schema was designed — better to visibly under-deliver than to
silently claim a security control that doesn't exist.
**To close:** Integrate ClamAV (or a hosted equivalent) as an async
post-upload step (a BullMQ job, matching the pattern already used for
outbox dispatch and CSV import), transitioning `scanStatus` from
`unscanned` to `clean`/`infected`, and gate the download-URL endpoint to
refuse `infected` files.

### 27. `S3ObjectStorageAdapter` lazily validates config — silent gap in test coverage, not just prod
**Where:** `S3ObjectStorageAdapter.getClient()`
**What:** Object storage config (`OBJECT_STORAGE_*`) is validated only on
first actual use, not at app boot, specifically so the app (and existing
e2e suites that don't touch attachments) keep working without a MinIO
container. This means: (a) a genuinely missing/misconfigured production
config wouldn't be caught until the first real upload attempt, not at
deploy time, and (b) this whole piece has ZERO integration or e2e test
coverage against a real MinIO container — consistent with several other
pieces in this build (Reporting, CSV import) that were verified manually
via `curl` first, with automated coverage as a deliberate follow-up
decision, not an oversight.
**To close:** Add a MinIO Testcontainers module to the integration/e2e
harnesses (same pattern as Postgres/Redis), and add a startup health-check
(not necessarily `validateEnv`'s hard-fail, since object storage isn't
needed for every deployment) that at least logs a warning if
`OBJECT_STORAGE_*` is unset.

## Testing Infrastructure

### 28. Unit test suite logs a Jest "worker failed to exit gracefully" warning
**Where:** `npm test` (unit suite only — integration/e2e legitimately hold
real DB/Redis handles, so a similar warning there wouldn't be surprising;
this is specifically the unit run, which should have zero real I/O).
**What:** `"A worker process has failed to exit gracefully and has been
force exited... Active timers can also cause this."` appears after all 146
unit tests pass. Not investigated — every test passes and nothing is
functionally broken, but a genuine leak in a suite with no I/O is worth
understanding eventually (likely candidates: an un-`.unref()`'d timer
somewhere, or a native binding like `argon2` holding a handle open).
**To close:** Run `npm test -- --detectOpenHandles` and trace the actual
source before it becomes a CI timeout problem as the suite grows further.

---

## Observability

### 29. Prisma health-check error message is occasionally empty in a narrow reconnection race
**Where:** `PrismaHealthIndicator.isHealthy()`
**What:** During live testing (stopping/starting the Postgres container
repeatedly), most failure states surfaced a genuinely useful message via
`collectErrorChainMessages()` (e.g. "Server has closed the connection").
But in the specific window right after `PrismaService`'s own pool-level
`error` listener already caught and logged a connection termination, a
subsequent health-check query sometimes throws a Prisma error with an
empty `.message` and no `.cause` to fall back to — nothing left to extract
at the JS level. Confirmed this is a genuine Prisma/`@prisma/adapter-pg`
limitation in that race window, not a bug in the chain-walking logic
itself (which worked correctly for every other failure state tested).
**Why acceptable:** The functionally important behavior — `status`
correctly toggling `"error"`/`"ok"` in lockstep with real DB availability
— held reliably across every test, including the cases with a thin
message. A readiness check's job is to accurately signal "can/can't serve
traffic," which it does; the message is a diagnostic nicety on top, not
the core contract. `PrismaHealthIndicator` also unconditionally logs the
full error server-side regardless of what the HTTP response manages to
extract, so an engineer investigating a real incident still has complete
information via logs even when the HTTP message is thin.
**To close:** Not planned — this is deep in Prisma 7's driver-adapter
internals (undocumented, version-specific), and chasing it further has
poor ROI relative to the safety net already in place (server-side logging)
for a cosmetic gap in an edge case. Revisit only if Prisma's error-wrapping
behavior changes in a future version, or if the thin message actually
becomes an operational problem in practice (unlikely, given logs already
carry full detail).

---

## Notifications

### 30. SMS is not actually integrated — logs a warning instead of sending
**Where:** `ConsoleSmsProvider`
**What:** No SMS provider account (Twilio, MSG91, VOS3000, etc.) exists to
integrate against. `SmsProvider` port exists and is wired into DI, but its
only implementation logs what would have been sent rather than sending
anything. Same honest-gap discipline as `Attachment.scanStatus: 'unscanned'`.
**To close:** Swap `ConsoleSmsProvider` for a real provider adapter once an
account/API key exists — the port abstraction means nothing else in the
codebase needs to change.

### 31. `PayrollRunApproved` notifies the payroll admin only, not each employee
**Where:** `NotificationSubscriber.handlePayrollRunApproved()`
**What:** The more useful notification — each employee on the payslip
getting their own "your pay is ready" email — needs one notification job
per payslip (resolved from `run.getPayslips`), not a single run-level
notification. Deliberately scoped down to avoid half-building the
per-employee version in this pass.
**To close:** Iterate `run.getPayslips` and enqueue one notification per
employee, with its own template (distinct from the admin-facing one).

### 32. Only 3 notification templates exist, not the full original catalog
**Where:** `src/notifications/templates/notification-templates.ts`
**What:** Covers `ExpenseApproved`, `ExpenseRejected`, `PayrollRunApproved`
— the highest-value requester-facing moments. Financial-period close
reminders, import-job completion notices, and other events from the
original brief have no template or subscriber registration yet.
**To close:** Additive — each new template + subscriber registration is
independent of the others, no architectural change needed to add more.

### 33. No delivery-tracking API — `NotificationLog` exists but nothing reads it
**Where:** `NotificationLog` (Prisma model)
**What:** Every send attempt is recorded (`pending`/`sent`/`failed`, with
error detail), but no endpoint exposes this — no way for an admin to see
"did this user's approval email actually arrive" without querying the DB
directly. Mirrors the same gap ImportJob's `/errors` endpoint solves for
CSV import, just not built for notifications yet.
**To close:** A small `GET /notifications` (or scoped to a specific
recipient/entity) endpoint, same shape as the import-errors endpoint.

### 34. `NotificationProcessor` had no operational logging — retries were invisible
**Where:** `NotificationProcessor.process()`
**What:** Every other BullMQ processor in this codebase
(`OutboxDispatchProcessor`, `ImportJobProcessor`) logs its outcome per run.
`NotificationProcessor` originally logged nothing on success or failure,
making retry attempts (and permanent failure) completely invisible in
server logs — confirmed directly via a manual test where 3 retry attempts
against a stopped Mailpit container produced zero console output, only
silent `notification_logs` DB rows.
**Status:** Fixed — now logs attempt number and outcome on both success and
failure, explicitly flagging the terminal "PERMANENTLY FAILED, no more
retries" case.

### 35. A permanently-failed notification has no recovery path
**Where:** `NotificationProcessor` / `NotificationsModule`'s BullMQ config
**What:** `attempts: 3` with exponential backoff means the ENTIRE retry
window is roughly 6-8 seconds, not minutes — confirmed via manual testing
(stopping Mailpit, approving an expense, restarting Mailpit ~35 minutes
later: the original notification was already permanently failed within
seconds of the first attempt and was never retried again, despite Mailpit
being back up long before any human would plausibly notice). Once BullMQ
exhausts `attempts`, that notification is gone — no dead-letter queue for
notifications specifically, no manual "retry this failed notification"
endpoint, nothing except noticing a `status: 'failed'` row in
`notification_logs` by querying the DB directly.
**Why acceptable so far:** Notifications are informational (a person still
sees their expense's real status via the API/UI regardless of whether an
email arrived) — losing one isn't a data-integrity problem the way losing
an audit entry or a payment would be. But it's still a real gap for a
"production-grade" claim, especially for a genuinely extended outage.
**To close:** Either (a) increase `attempts` with longer backoff for
notifications specifically (a real SMTP/email-provider outage lasting
minutes-to-hours is plausible), and/or (b) add a manual
`POST /notifications/:id/retry` endpoint (admin-only) that re-enqueues a
permanently-failed `NotificationLog` row — same DLQ-recovery pattern
already built for CSV import's per-row failures, just not yet extended to
this subsystem.

---

## Virus Scanning (ClamAV) — Wiring Bugs Found & Fixed

### 36. Multiple e2e-breaking bugs surfaced while adding real virus scanning — all resolved
**What happened:** Adding ClamAV integration (closing item #26) triggered a
chain of issues, each masking the next:
1. `StorageModule` registered the `attachment-scan` BullMQ queue via
   `BullModule.registerQueue(...)` but never re-exported `BullModule` —
   `@Global()` only propagates a module's own `exports`, not providers
   pulled in from an internally-imported module without re-exporting them.
   `AttachFileHandler` (in `ExpenseModule`) couldn't resolve the queue
   token, so the entire app failed to boot in every e2e test.
   **Fixed:** `StorageModule` now re-exports `BullModule`.
2. Every e2e spec's `afterAll(() => app.close())` was unguarded — when
   `beforeAll` (app boot) failed, `app` stayed `undefined`, and `afterAll`
   threw its own `TypeError`, which Jest reported instead of the real
   NestJS DI error underneath it. **Fixed:** `app?.close()` everywhere.
3. `cleanE2eDatabase()`'s manually-maintained table list was missing 6
   tables added across later pieces (`attachments`, `expense_read_model`,
   `import_jobs`, `inbox_records`, `failed_import_records`,
   `notification_logs`) — exactly the drift risk flagged in that
   function's own original comment, which wasn't kept up to date in
   practice despite the warning. **Fixed:** table list updated. **Not
   fixed:** the underlying maintenance burden — see item #37 below.
4. A unit test file's handler constructor calls (7 call sites) hadn't been
   updated after a new constructor parameter was inserted mid-signature.
   **Fixed:** consolidated into one `buildHandler()` helper so future
   constructor changes touch one line, not seven.
5. `tsconfig.json` had `isolatedModules: true` set, which requires every
   type used in a decorated class signature (constructor params on
   `@Injectable()` classes) to be imported via `import type` explicitly —
   this build's actual toolchain (plain `tsc` via `nest build`, `ts-jest`
   without its own isolated-modules option) never needed that constraint.
   Surfaced as 101 `TS1272` errors on a full `npm run build`, invisible
   via `ts-jest` (which compiles differently). **Fixed:** removed the flag
   — safe for this toolchain; would need proper `import type` annotations
   (not just re-disabling the flag) if a per-file transpiler (SWC/esbuild)
   is adopted later.

All 5 issues confirmed resolved: 31/31 e2e tests passing, 146/146 unit
tests passing, `npm run build` clean.

### 37. `cleanE2eDatabase()`'s table list still requires manual maintenance
**Where:** `test/integration/setup/db-helper.ts`,
`test/e2e/setup/e2e-db-helper.ts`
**What:** Item #36's point 3 got patched, but the underlying risk is
unchanged — the table list is still a hardcoded array that silently falls
out of sync every time a new table is added, exactly as it already did
once. The original design comment reasoned this was deliberate (avoid
silently including new tables without an explicit decision) — but in
practice, "explicit decision" has meant "gets forgotten," twice now if you
count the original build and this incident.
**To close:** Switch to dynamically querying
`information_schema.tables` (filtered to exclude Prisma's own
`_prisma_migrations`) and truncating everything found, rather than a
hardcoded list — trading "must remember to update a list" for "always
truncates whatever actually exists," which is the safer default for test
cleanup specifically (a stale test fixture leaking into another test is a
worse failure mode than accidentally truncating a table that didn't need
it in a throwaway test database).

### 38. Async attachment scan jobs can race against e2e test cleanup
**Where:** e2e test teardown/setup boundary, `AttachmentScanProcessor`
**What:** Confirmed once, harmlessly: `cleanE2eDatabase()` truncating
`attachments` between tests can delete a row a still-in-flight scan job
(from the previous test) is about to update, producing a caught, logged,
retried-to-permanent-failure Prisma error (`P2025`, record not found).
Doesn't fail any test — the orphaned scan simply fails against a target
that's correctly gone — but adds log noise.
**Why acceptable:** This is a test-environment-only artifact (production
never truncates tables mid-workload); the underlying "update targets a
possibly-deleted row" pattern already fails safely everywhere else it
occurs in this codebase (same class of issue as the outbox dispatcher's
`updateMany` fix from earlier in this build).
**To close:** Low priority — could wait for pending scan jobs to settle
between e2e tests, but the cost (log noise in test output only) doesn't
currently justify the added test complexity.

---

*Last updated: 2026-08-11, after resolving the ClamAV integration wiring bugs.*