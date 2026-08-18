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

### 7b. ~~Audit chain is a single global sequence across all organizations, not per-organization~~ — RESOLVED
`AuditLogService.record()` now scopes both the chain-walk query
(`findFirst({ where: { organizationId } })`) and the advisory lock key
(`audit_log_chain:${organizationId}`) per organization. Verified with a
new integration test: 20 writes interleaved across two organizations
concurrently produce two independently unbroken chains with zero hash
overlap between them — the actual disclosure concern this item was about.
No backfill was needed since only one organization has ever existed to
date, so historical data already trivially satisfies per-org ordering. 

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

### 19. Prisma 7 driver adapters + `pg.Pool` error listeners — reference; actionable part RESOLVED
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
**Status:** The documentation above stays — both facts are still load-bearing
for anyone constructing a `PrismaClient` or a `pg.Pool` in this codebase, and
CLAUDE.md's gotchas #1/#2 point here. The one actionable part is **RESOLVED**:
`PrismaService`'s `pool.on('error', ...)` no longer mirrors the test harness's
silent swallow. It branches on `'terminating connection'`/`57P01` and logs
`warn` for that expected-during-restart case, `error` (with stack) for
anything else — every branch logged, no silent case, which is the distinction
this item was about. The test harness keeps its swallow, which is still
correct there because we control exactly when and why the DB goes away.

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

### 22. ~~CSV import uses a fixed column schema, not configurable mapping~~ — RESOLVED
Configurable per-organization column mapping now exists end to end: a
`ColumnMapping` model (unique per `(organizationId, name)`), `POST`/`GET
/imports/column-mappings` to save (upsert) and list them, and
`POST /imports?mappingId=` to import a file whose headers match nothing in
the canonical set. `ImportJob.resolvedMapping` **snapshots** the mapping at
upload time, so later edits to a saved mapping cannot retroactively change
how an already-processed job was parsed. Remapping happens at the
`CsvProviderAdapter` boundary, which keeps `CsvNormalizer` and everything
downstream of it unaware that mapping exists at all — a mapped file and a
canonical-header file reach the normalizer in exactly the same shape.

Four gaps were found and closed while verifying this was genuinely done
rather than only *appearing* done:
- **No e2e coverage at all.** The capability had unit tests for the
  remapping function but nothing exercising save → resolve-at-upload →
  worker over real HTTP, which is this project's stated bar for a new
  capability (as opposed to wiring). Added 9 e2e tests, including a
  deliberate CONTROL case — the same non-canonical file uploaded WITHOUT a
  `mappingId` must fail — so a passing import cannot be explained by
  anything except the mapping actually being applied, plus a
  cross-organization case asserting a `mappingId` owned by another org
  returns 404 rather than someone else's mapping.
- **The required-field list was duplicated** across
  `csv-provider.adapter.ts` and an application-layer `required-fields.ts`,
  validated independently in each — the same silent-drift risk #37 closed
  for the test-cleanup table list. Both now import from
  `integration/domain/canonical-csv-fields.ts`, which owns the field lists
  and a single shared `validateColumnMappingShape()`.
- **A bad mapping saved with a 201 and only failed later, inside the
  worker.** `SaveColumnMappingDto` validated `@IsObject()` and nothing
  more (NestJS's `whitelist`/`forbidNonWhitelisted` do not descend into a
  plain-object property — confirmed by test, not assumed), and the handler
  checked only that required keys were *present*. So `{department: 123}`,
  `{currency: ''}`, or an entirely invented field name all persisted
  happily and then died in `ImportJobProcessor`, where the reason reached
  the server log and nothing else. Save-time validation now rejects
  unknown fields, non-string/empty values, and missing required fields
  with a specific 400. The adapter runs the same validator, so a mapping
  written directly to the DB — or saved before this change — still fails
  loudly instead of producing half-empty rows.
- **`resolvedMapping` was cast to `Record<string, string> | undefined`**
  when Prisma actually returns `null` for an unset JSON column. Behavior
  was correct only because the adapter happens to test truthiness; anyone
  later tightening that to `!== undefined` would have had `null` silently
  take the mapping path. Now normalized explicitly with `?? undefined`.

Also projected `GET /imports/column-mappings` through an explicit
`ColumnMappingView` rather than returning raw Prisma rows, which were
echoing `organizationId` back to a caller that already knows it.

Two pieces were deliberately left open — see #43 and #44.

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

### 26. ~~No real virus scanning — attachments default to "unscanned," not actually checked~~ — RESOLVED
ClamAV is integrated as an async post-upload BullMQ job, matching the
pattern already used for outbox dispatch and CSV import:
`AttachFileHandler` enqueues `attachment-scan` after persisting the row,
`AttachmentScanProcessor` downloads the object, scans it via a new
`VirusScanPort`/`ClamAvScanAdapter`, and transitions `scanStatus` to
`clean`/`infected`. A scan that throws is re-thrown so BullMQ retries,
leaving `scanStatus: 'unscanned'` in the meantime — which still blocks
download, so a transient scanner outage fails closed rather than open.

Download gating ended up *stricter* than this item asked for:
`GetAttachmentDownloadUrlHandler` refuses anything where `scanStatus !==
'clean'`, not just `infected`, so a file that has not finished scanning yet
is also refused (via `AttachmentNotSafeToDownloadError`, a `DomainError` →
409) rather than being downloadable during the scan window.

Verified end-to-end against a real ClamAV container in the e2e harness: an
uploaded EICAR test file is detected as `infected` and its download is
refused. The chain of wiring bugs this integration surfaced is recorded
separately as #36.

### 27. `S3ObjectStorageAdapter` still lazily validates config — the test-coverage half is now closed
**Where:** `S3ObjectStorageAdapter.getClient()`
**What:** Originally two gaps in one entry. The second is now closed: a
MinIO Testcontainers module is wired into the e2e harness (same pattern as
Postgres/Redis), and `attachments.e2e.spec.ts` exercises upload, scan and
download against a real MinIO container, so this piece is no longer
untested.
**Still open:** object storage config (`OBJECT_STORAGE_*`) is validated
only on first actual use, inside `getClient()`, not at app boot. A
genuinely missing or misconfigured production config still wouldn't surface
until the first real upload attempt rather than at deploy time.
**Why acceptable so far:** The lazy check is deliberate — it lets the app,
and every e2e suite that doesn't touch attachments, boot without a MinIO
container at all. A hard-fail at boot would couple every deployment to
object storage being configured, which isn't true for every deployment.
**To close:** A startup log warning (not `validateEnv`'s hard-fail) when
`OBJECT_STORAGE_*` is unset — enough to make a misconfiguration visible at
deploy time without making storage a boot dependency.

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

### 31. ~~`PayrollRunApproved` notifies the payroll admin only, not each employee~~ — RESOLVED
`NotificationSubscriber` now enqueues one `PayslipReady` notification per
payslip (in addition to the existing admin-facing `PayrollRunApproved`
notification), resolved via the new `Employee.userId` link from item #41.
Employees with no linked `User` account are correctly skipped (logged at
debug, not an error) rather than causing a failure.

### 32. Only 3 notification templates exist, not the full original catalog
**Where:** `src/notifications/templates/notification-templates.ts`
**What:** Covers `ExpenseApproved`, `ExpenseRejected`, `PayrollRunApproved`
— the highest-value requester-facing moments. Financial-period close
reminders, import-job completion notices, and other events from the
original brief have no template or subscriber registration yet.
**To close:** Additive — each new template + subscriber registration is
independent of the others, no architectural change needed to add more.

### 33. ~~No delivery-tracking API — `NotificationLog` exists but nothing reads it~~ — RESOLVED
`GET /notifications` (filterable by status) and `GET /notifications/:id`
added, gated behind the new `notification:manage` permission.

### 34. ~~`NotificationProcessor` had no operational logging — retries were invisible~~ — RESOLVED
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

### 35. ~~A permanently-failed notification has no recovery path~~ — RESOLVED
`POST /notifications/:id/retry` added — validates the target is genuinely
`failed` (not `pending`/`sent`), re-enqueues a fresh BullMQ job using the
original recipient/template/data (now persisted on `NotificationLog` via
the new `templateData` column). Verified end-to-end: stopped Mailpit,
triggered a permanent failure, restarted Mailpit, manually retried via the
new endpoint, confirmed the email actually arrived — the exact recovery
path that didn't exist before.

---

## Virus Scanning (ClamAV) — Wiring Bugs Found & Fixed

### 36. ~~Multiple e2e-breaking bugs surfaced while adding real virus scanning~~ — RESOLVED
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

### 37. ~~`cleanE2eDatabase()`'s table list still requires manual maintenance~~ — RESOLVED
Both `cleanDatabase()` (integration) and `cleanE2eDatabase()` (e2e) now
discover tables dynamically via `pg_tables` instead of a hardcoded array,
cached per test file. A new table added in any future piece gets cleaned
automatically — no more silent drift, closing the exact failure mode that
already happened once (TECH_DEBT #36).

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

## Reference Data

### 39. ~~`isActive` on Department/Vendor/Category/Project is not enforced at expense-creation time~~ — RESOLVED
`CreateExpenseHandler` now validates department/category (required) and
vendor/project (when provided) exist and are active BEFORE entering the
transaction — also closes a related, previously-unflagged gap: the handler
never validated these IDs at all before, relying entirely on the DB's FK
constraint (which would have surfaced as a raw Prisma error, not a clean
domain error). `ImportRecordMapper` gets the same treatment, with one
deliberate asymmetry: a CSV import matching a deactivated VENDOR
reactivates it (vendors are the least strictly governed type), while
department/category stay hard-blocked until explicitly reactivated via the
reference-data API. `CreateExpenseHandler` had no unit test file at all
before this fix — added one.

---

## Authorization

### 40. ~~`PermissionGuard` returned generic `ForbiddenException`s instead of specific ones~~ — RESOLVED
**Where:** `src/auth/authorization/permission.guard.ts`
**What:** NestJS wraps a guard's `return false` in a generic
`ForbiddenException('Forbidden resource')` automatically — every actual
permission/scope denial in this app (as opposed to the "not authenticated"
and "resource not found" paths, which already threw specific exceptions)
has surfaced this way since TECH_DEBT #3 was closed, silently, across the
whole build. Discovered when a real 403 (missing seed data for a newly
added permission) gave no actionable information.
**Status:** Fixed — every denial branch now throws a specific
`ForbiddenException` naming the missing permission, the user's actual
roles, or which scope (own/department) they're limited to. Verified: a
denied request now returns `"None of your roles (employee) grant the
'reference-data:manage' permission"` instead of `"Forbidden resource"`.
Full unit + e2e suite reconfirmed green after the change.

---

## Payroll / Notifications

### 41. ~~`Employee` and `User` had no relationship~~ — RESOLVED
**Where:** Prisma schema
**What:** `Employee` (payroll/salary data) and `User` (login/auth) were
built as genuinely separate concepts across separate contexts, correctly
per DDD boundaries — but nothing ever linked them, because nothing before
this needed to. `GetPayrollRunByIdHandler` only ever returned raw
`employeeId`, never resolving a login identity from it. Discovered
concretely: building "notify each employee their payslip is ready"
required resolving an employee → their email, and there was no path to do
that at all.
**Status:** Fixed — added nullable `Employee.userId` (unique FK to `User`).
Nullable is deliberate, not a placeholder: an `Employee` can legitimately
exist for payroll purposes without ever having platform login access
(e.g. a contractor paid via payroll who was never given system access).

### 42. ~~No admin API exists to link/unlink an `Employee` to a `User`~~ — RESOLVED
`EmployeeController` now exists, gated on `payroll:create` throughout, with
`PATCH /employees/:id/link-user` and `PATCH /employees/:id/unlink-user`
closing the specific gap this item named. Building it out properly also
picked up the endpoints an employee record needs to be manageable at all
rather than seed-only: `POST /employees`, `GET /employees/:id`,
`GET /employees`, and `PATCH /employees/:id/deactivate` (soft delete, per
critical convention #3 — employees are referenced historically by payslips
and must never be hard-deleted).

---

## Integration Layer — Column Mapping Follow-ups

### 43. Saved column mappings can be created and listed, but never deleted
**Where:** `ImportController`, `column-mapping.handlers.ts`
**What:** `POST /imports/column-mappings` upserts by `(organizationId,
name)` and `GET /imports/column-mappings` lists them, but there is no
delete. A mapping saved by mistake, or for a source system no longer in
use, stays in the picker forever. Renaming is also impossible — saving
under a new name creates a second mapping rather than moving the old one.
**Why acceptable so far:** Upsert-by-name means a wrong mapping can always
be *corrected* in place (the common case) even though it can't be removed,
and the list is scoped per organization, so clutter is bounded by how many
distinct source formats one org actually imports from.
**To close:** A `DELETE /imports/column-mappings/:id` gated on the same
`expense:create` permission. Worth deciding at that point whether delete
should be a hard delete or follow this codebase's soft-delete convention
(critical convention #3) — `ImportJob.resolvedMapping` snapshots the
mapping content at upload time and holds no FK to `ColumnMapping`, so no
historical import job would be damaged by a hard delete, which is the
usual reason that convention exists. This is the rare case where hard
delete is probably defensible; it should be an explicit decision rather
than an assumption either way.

### 44. A whole-file import failure records no reason the API can return
**Where:** `ImportJobProcessor.process()`, `ImportController.getStatus()`
**What:** When a file fails to fetch or parse at all (bad mapping,
non-CSV content, object storage unreachable), the processor sets
`ImportJob.status = 'failed'` and logs the reason server-side — but
persists it nowhere the API exposes. `GET /imports/:jobId` has no error
field, and `GET /imports/:jobId/errors` returns `[]`, because a whole-file
failure produces no `FailedImportRecord` rows (those are per-row). The
user sees `status: "failed"` with no explanation and no way to self-serve
a fix; the actual message is only reachable by an engineer reading logs.
**Why acceptable so far:** Pre-existing since the import pipeline was
built, not introduced by the column-mapping work. Row-level failures — by
far the common case — are already surfaced properly via
`FailedImportRecord`. Closing #22 also narrowed the biggest cause of
whole-file failures: a malformed mapping is now rejected synchronously at
save time with a specific 400, so the most likely way to reach this state
is now an operational problem (storage unreachable) rather than a user
mistake.
**To close:** Add a nullable `failureReason` column to `ImportJob`,
populate it in the processor's catch block alongside the existing log, and
return it from `getStatus()`. Small and contained, but it is a schema
change plus a migration, so it was not folded into #22's close-out.

### 45. ~~`npm run start` points at the wrong entrypoint — the production start script is broken~~ — RESOLVED
`"start"` now runs `node dist/src/main.js`, matching where `nest build`
actually emits. Verified by running it for real against the docker-compose
stack: the app boots and serves, `GET /api/v1/health/liveness` returns
`200 {"status":"ok"}`, `GET /api/v1/health/readiness` returns 200 with
`database: up` and `redis: up`, and Swagger serves at `/api/docs` — none of
which was reachable through this script before.

Deliberately fixed the *script*, not the *layout*: `tsconfig.json`'s
`include` still covers `prisma.config.ts` and `test/`, so the inferred
`rootDir` is still the project root and output still lands one level deeper
than a plain `src`-only build would put it. Setting an explicit
`rootDir`/`outDir` remains the other legitimate fix, and it is still the
better one to make *once*, alongside the first Dockerfile (Phase 10), where
the whole build-output layout gets decided in one place. Pointing the
script at today's real output makes it work now without pre-empting that
decision — if the layout later changes, this one line changes with it.

---

*Last updated: 2026-08-18, after closing #22 (configurable CSV column
mapping) and filing #43/#44 for the follow-ups deliberately left open,
plus #45 for a broken start script found during manual verification.*