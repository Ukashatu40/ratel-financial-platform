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

### 8. ~~No field-level old/new value diffing~~ — RESOLVED
**What it was:** `AuditSubscriber` captured each event's payload as `newValue` and
left `oldValue` NULL. The column had existed since the first audit migration
(`20260802090359/migration.sql:31`) and **nothing had ever written to it** —
`oldValue` appeared nowhere in `src/` or `test/`. The trail recorded that something
changed, never what it changed from.

**The original "to close" was wrong about the cost.** It predicted "every mutating
aggregate method must capture and pass forward an explicit diff." That turned out to
be unnecessary: the diff is computed **generically in `AggregateRoot`**, once, and no
mutating method was touched. Two preconditions made that possible, both verified
before committing to the approach rather than assumed:
- All four aggregates already exposed `toProps()`.
- Every one of the 13 `recordEvent` call sites mutates `this.props` **before**
  recording. So at record time, current state is the after-image and the captured
  baseline is the before-image.

Each aggregate contributes one line (`snapshotState() { return this.toProps(); }`)
plus a `captureBaseline()` call in `reconstitute()`. `snapshotState` is **abstract**
on purpose: a new aggregate must decide consciously instead of silently contributing
no diff and leaving an audit gap nothing would flag.

`AggregateRoot.recordEvent` merges `changes: { field: { from, to } }` into the
payload; `AuditSubscriber` lifts the `from` side into `oldValue`. The baseline
advances at every `recordEvent`, so a second mutation in the same unit of work diffs
against the intermediate state — without that, a close-then-reopen would report
`status: open -> reopened` and hide that the period passed through `closed`.

`create()` deliberately does **not** capture a baseline, so creation events carry no
`changes` and `oldValue` stays NULL. "Nothing existed before" is the honest record; a
diff against an imaginary empty row would be a fabrication.

**Three blind spots this approach does NOT cover** — stated because a props diff
structurally cannot see them, not because they were overlooked. See #52.

**The hash did not cover the payload, so the diff was added under a new hash
version.** `HashableEntry` covered only organizationId/entityType/entityId/action/
actorUserId/correlationId/createdAt — `oldValue`, `newValue` and `reason` were
excluded, meaning the entire substance of an entry could be rewritten without
breaking the chain. `computeEntryHashV2` now covers them, with a
`hash_version` column defaulting to 1 so existing rows stay verifiable under v1 and
a future verifier picks its function per row. No backfill needed.

**A real trap, caught by reasoning and then proven by test.** `old_value`/`new_value`
are `jsonb`, which does not preserve key insertion order. Hashing with plain
`JSON.stringify` would produce hashes **no verifier could ever reproduce from the
stored row** — invisible today (nothing verifies) and surfacing later as every
historical row appearing tampered. v2 therefore uses `canonicalStringify`
(recursively sorted keys) from the new
`src/shared-kernel/serialization/canonical-json.ts`.

This was **verified by falsification, not just asserted**: with `canonicalStringify`
swapped for `JSON.stringify`, the integration test fails with two concrete differing
hashes; restored, it passes. So jsonb really does reorder keys here, the test really
detects it, and the fix really is what closes it.

**`audit:view` was an orphaned permission.** Seeded for `auditor`
(`role-permissions.ts:34`) and referenced **nowhere in code** — the role held a
permission that guarded nothing, and the trail was reachable only via psql. So
`GET /audit-entries` was built alongside this, in a new top-level
`src/audit-log/` supporting module following #47's `src/event-deliveries/`
precedent — **not** a bounded context (no aggregate, no state machine) and
deliberately **not** in `src/shared-kernel/audit/`, since a controller there would
put HTTP concerns inside the layer every context depends on, inverting the Phase 4.3
dependency rule. Writing stays in the kernel; reading is a supporting concern.

Filters (`entityType`, `entityId`, `actorUserId`, `action`, `from`/`to`, `offset`,
`limit`) are validated at the boundary so a bad value is a specific 400 rather than a
Prisma error rendered as a useless 500 (convention #5). `limit` is capped at 500: an
audit trail is unbounded, unlike #47's operator views, so it genuinely needs paging.
`entityType`/`action` are deliberately **not** `@IsIn` over a fixed list — entity
types come from each event's `aggregateType` and reference-data contributes its own,
so a closed enum would silently stop matching new auditable types, failing in the
direction of "no history found".

**Coverage:** 13 unit tests (diff semantics, baseline advance, `Money`/`Date`
normalization, create-vs-reconstitute, canonical JSON properties), 4 new integration
tests including the jsonb round-trip proof, and 7 e2e tests. The e2e set asserts
`oldValue.status === 'open'` after a real close through the full path (HTTP →
aggregate → outbox → BullMQ poller → subscriber → Postgres), NULL `oldValue` for a
creation event, a **403 for `finance_director`** on `GET /audit-entries` (so the 200
for `auditor` cannot be explained by the guard never running), an exact response key
set (#21) with `organizationId` absent (#22/#47), a cross-org entry excluded, and
400s for an unknown query param, a malformed date and an over-cap limit.

### 52. Three audit blind spots a props diff cannot see
**Where:** `PayrollRun` and `SalaryStructure` aggregates.
**What:** #8's generic diff compares an aggregate's own `props` before and after a
mutation. Three real state changes fall outside that:
1. **`SalaryStructure` records ZERO events.** It has `recordEvent` available and never
   calls it, so compensation changes — arguably the most sensitive data in the system
   — produce no audit entry at all. Not a diff gap: a total absence of audit.
2. **`PayrollRun.startProcessing()` changes `status` to `processing` and records no
   event.** The transition into processing is invisible to the trail, so the history
   jumps from `approved` to `completed`.
3. **`PayrollRun.addPayslip()` mutates `this.payslips`, a sibling array, not `props`.**
   It does record `PayrollRunPayslipAdded`, so the action is audited, but the event
   carries no `changes` and its `old_value` is NULL — the payslip count before and
   after is not recoverable from the entry.

**Why not fixed with #8:** (1) and (2) are missing domain events, not diff plumbing —
adding them changes what flows through the outbox and what every global subscriber
sees, which is event-pipeline work deserving its own review (CLAUDE.md asks before
altering the event pipeline). (3) needs `snapshotState()` to include derived child
state, which is a design question about what "the aggregate's state" means for diffing
rather than a bug.
**To close:** decide whether `SalaryStructure` should emit lifecycle events (almost
certainly yes, given what it holds), add a `PayrollRunProcessingStarted` event, and
consider including `payslipCount` in `PayrollRun.snapshotState()`.

### 53. No audit chain verifier exists — the tamper-detection guarantee is unimplemented
**Where:** `src/shared-kernel/audit/hash-chain.util.ts`
**What:** the comment on `computeEntryHash` states that tampering is "detectable by
recomputing the chain". **Nothing recomputes it.** `computeEntryHash`/`V2` have
exactly one caller — `AuditLogService.record()` — and the existing tests check only
*linkage* (each row's `prevHash` equals the prior row's `entryHash`), never that a
row's hash matches its own content. A row could be edited and its `entryHash`
recomputed by an attacker, or edited without touching the hash, and no code path in
this system would notice.

Linkage checks are not worthless — they catch a row deleted or reordered mid-chain —
but they are strictly weaker than what the comment promises, and the promise is the
kind of thing an auditor would rely on.

**Why now:** #8 made this tractable. `hash_version` exists, so a verifier can pick
`computeEntryHash` for v1 rows and `computeEntryHashV2` for v2 rows instead of
reporting every historical row as tampered. That was the blocking problem.
**To close:** a `ChainVerifierService` that walks a single organization's chain in
`createdAt` order, recomputes each row's hash under its own `hash_version`, and
reports the first mismatch with its row id — plus `GET /audit-entries/verify` behind
`audit:view`. Note the honest limit it will still have, and say so in its response:
verification proves entries were not **altered**; it cannot prove none were
**missing**, because a chain with an entry removed and subsequent hashes recomputed
is still internally consistent. That is the same gap #47 records for a
permanently-failed `AuditSubscriber` delivery.

### 54. `jsonb` numeric normalization is an unhandled residual risk in hash v2
**Where:** `src/shared-kernel/serialization/canonical-json.ts`
**What:** `canonicalStringify` handles jsonb's key reordering, which is the failure
mode that would have broken hash v2 immediately. jsonb performs two other
normalizations it does **not** handle: numbers are canonicalized (`1.0` stored and
returned as `1`, `1e2` as `100`) and duplicate keys are dropped. If an audit payload
ever contains a float whose textual form changes on round-trip, the recomputed hash
will not match and the row will look tampered.
**Why acceptable now:** audit payloads are event payloads, which carry strings,
booleans, null and small integers. `Money` serializes `minorUnits` as a **string**
precisely so bigint amounts never become floats (convention #1), so the most
likely source of a problematic number is already excluded by design.
**To close:** either normalize numbers to a canonical decimal string inside
`toJsonSafe`, or — better — have the future verifier (#53) hash the **raw jsonb text**
returned by Postgres (`SELECT new_value::text`) rather than a re-serialized JS object,
which sidesteps every normalization question at once. Worth deciding when #53 is
built, since that is the only consumer that would care.

### 9. ~~Failed event delivery to one subscriber is only logged, not retried~~ — RESOLVED
**Why this mattered more than the original wording suggested:** `AuditSubscriber`
is registered globally, so it is the only thing writing the audit trail, for
every event. A single transient failure in its DB write removed a financial
event from the record permanently — and **undetectably**, because the hash chain
links each entry to the previous one and therefore proves entries were not
ALTERED. A chain that is simply missing an entry is still a perfectly valid
chain. Tamper-evidence catches modification, never omission. That is the same
guarantee #4 (append-only grant) exists to protect, breached from the other
direction. The same silence also let `ExpenseReadModelProjector` drift the
reporting read model away from the source of truth, and let
`NotificationSubscriber` drop a payslip-ready notification.

Two related facts made it invisible: `outbox_events.status = 'dispatched'` was
set even when a subscriber failed (so the enum's `failed` member was never
used), and `DomainEventDispatcher` plus `OutboxDispatchService` had **zero test
coverage** between them.

**Subscriber identity first, because it is the load-bearing prerequisite.**
Subscribers registered anonymous closures, so failures were logged as
`Handler 2` — an index into a runtime array, useless as a diagnostic and
unusable as a retry key. `register()`/`registerGlobal()` now take a subscriber
name (5 call sites, 3 subscribers), and `dispatch()` returns named failures
instead of swallowing them. `Promise.allSettled` isolation is unchanged. Names
are string LITERALS, not `SomeClass.name`, because the value is persisted —
deriving it from a class name would mean a later rename silently orphans stored
retry rows. Duplicate names are rejected at boot rather than discovered when a
retry picks the wrong handler.

**Retry is per-(event, subscriber), never per-event.** `NotificationSubscriber`
enqueues email, so re-dispatching a whole event to recover one failed subscriber
would re-run the ones that already succeeded and send duplicates. New
`dispatchTo(name, event)` resolves the handler registered for that event's type
and re-invokes only it; an unknown name throws loudly rather than silently
no-op'ing, which would otherwise mark a delivery recovered that never happened.

New `failed_event_deliveries` table (naming follows `failed_import_records`),
unique on `(outboxEventId, subscriberName)` so retries update one row instead of
accumulating history that makes "is this still broken?" unanswerable. Redelivery
runs on a BullMQ queue with 5 attempts on exponential backoff from 5s, and the
terminal attempt logs `PERMANENTLY FAILED, no more retries`, matching #34's
wording. Failures are **persisted before** the enqueue, so a queue outage
degrades to "recorded but not auto-retried" rather than losing the failure —
which is the class of silent loss this whole item is about.

Design decisions worth recording, since each had a defensible alternative:
- **The outbox row still says `dispatched` even when a subscriber failed.** That
  status means "handed to the dispatcher"; one event has N per-subscriber
  outcomes, which a single column cannot express. Adding `partially_dispatched`
  would still not say WHICH subscriber failed, so the separate table is needed
  either way — and two sources of truth would need keeping in sync.
- **No foreign key to `OutboxEvent`.** A cascade would let a future outbox
  retention job silently delete the record of a permanently-lost audit entry,
  which is exactly the evidence an operator needs. The redelivery worker instead
  handles "outbox row is gone" explicitly by marking the delivery permanently
  failed with `payload unrecoverable`.
- **`OutboxDispatchService` schedules retries through a port**, not an injected
  BullMQ `Queue`, preserving its documented property of having zero BullMQ
  imports — the entire reason it exists separately from `OutboxDispatchProcessor`.
- **Event reconstruction moved into a shared `toDomainEvent` mapper.** Two
  callers now rebuild the event from its outbox row (first delivery, and retry);
  reconstructing it separately in each would be the silent-drift risk #22/#37
  closed, and would hand a retrying subscriber a subtly different event.

**Two real bugs were caught by actually running this, not by review:**
1. **BullMQ rejects a custom `jobId` containing `:`** (`Custom Id cannot contain
   :` — it uses colons for Redis key namespacing). The dedupe key was
   `redeliver:${id}`, so every enqueue threw. The failure was caught and logged
   as "could not enqueue its retry", which meant retries were **silently never
   scheduled while everything else looked healthy** — the e2e test is the only
   thing that would ever have surfaced it. Now `redeliver-${id}`.
2. **`attempts` under-counted on exactly the rows that matter most.** Manual
   verification showed a permanently-failed delivery reporting `attempts=4` after
   6 real delivery attempts: the redelivery counter overwrote the original
   delivery's count, and `markPermanentlyFailed` left the value stale. `attempts`
   now means total deliveries (original + redeliveries) and is written on both
   the recovered and permanently-failed transitions.

**Verification.** 33 new tests: unit coverage for the dispatcher (15), the
redelivery service (7), the redelivery processor's terminal-attempt logic (6 —
unreachable in e2e without waiting out 75s of backoff), and
`OutboxDispatchService` (7, its first ever). Integration coverage (6) for the
compound-unique upsert behaviour, which is a DB guarantee a fake Prisma client
would happily fake — the same reasoning #7 applied to the audit chain. Three e2e
tests register a deliberately-flaky subscriber into the REAL dispatcher of the
REAL booted app and let the real poller, real queue and real Postgres run,
including the isolation control: `AuditSubscriber` must have written exactly ONE
entry even though the flaky subscriber was invoked twice, which is the
duplicate-email guarantee asserted through production code.

Manually verified against docker-compose, mirroring #35's stop-Mailpit-and-retry
approach: renamed `audit_log_entries` out from under the app, emitted a real
event, watched the failure get recorded and retried at exactly the configured
backoff (+5s, +10s, +20s, +40s), renamed the table back mid-backoff, and watched
a retry succeed — `status: recovered, attempts: 5`, with the audit entry that
would previously have been lost present in the table and the chain intact (41
entries, 41 distinct hashes). Also confirmed the permanent path: left the table
broken and watched all 5 attempts exhaust into `permanently_failed`.

**CORRECTION — automatic retry only ever worked for a pair's FIRST failure.**
Found while scoping #47, in shipped code, by reading the dedupe key rather than
by any test. `BullMqEventDeliveryRetryScheduler` enqueues with
`jobId: redeliver-${failedDeliveryId}`, and that id is **stable across failure
episodes**: `failed_event_deliveries` is upserted on its
`(outboxEventId, subscriberName)` unique, so the same pair failing again reuses
the same row, hence the same jobId. `EVENT_REDELIVERY_JOB_OPTIONS` set only
`attempts` and `backoff` — no `removeOnComplete`/`removeOnFail` — so a finished
job stayed in Redis under that id forever, and BullMQ honours a custom jobId in
`completed` and `failed` as well as in flight. Every subsequent `queue.add()`
for that pair therefore returned the existing job and enqueued **nothing**,
without raising anything.

**It was a defect, not a design choice, and the code says so.** The dedupe
comment reasoned about the concurrent case only ("keeps one job rather than
running the subscriber twice concurrently"), which is correct and still holds.
But `recordFailures`'s update branch deliberately resets a `permanently_failed`
row back to `pending_retry`, commented "a fresh failure for a pair that had been
given up on is a live problem again" — and that intent was **unreachable**: the
row revived, and then sat in `pending_retry` forever with no job to move it.

**Why #9's own verification missed it.** All three e2e tests and the manual
docker-compose run exercised exactly ONE failure episode per pair — the recovery
test fails once then recovers, the permanent-failure test never recovers. Nothing
asked the same pair to fail a *second* time, so the retained-job path was never
entered. The blast radius is the same shape as the colon bug above: the common
case #9 was built for (a single transient blip) worked, and everything past it
silently did not.

**Fixed** by setting `removeOnComplete: true` / `removeOnFail: true`, which
releases the id when a job finishes and narrows dedupe to exactly what was
intended — one *live* retry per failure row, while a new episode can always be
scheduled. Nothing is lost by discarding the Redis job: per this item's own
design the durable record is the Postgres row (`status`, `attempts`,
`lastError`), which is also what #47 will read. It additionally bounds Redis
growth, which retaining every completed and permanently-failed job did not.

**Also fixed: `EVENT_DELIVERY_RETRY_SCHEDULER` was provided by `JobsModule` but
absent from its `exports`**, so nothing outside that module could inject the port
— #47's retry endpoint could not have been wired to it at all. Now exported.

Covered at two layers, deliberately split: 1 e2e test is the **proof** (a fake
`Queue` cannot exhibit BullMQ's id-retention semantics, which is the whole
mechanism), driving a real second delivery by resetting the outbox row to
`pending` for the live poller and asserting the pair recovers *twice*. 5 unit
tests are the **fast guard**, because the two halves of the fix live in different
files — the id is chosen in the scheduler, the options that release it in
`event-redelivery.queue.ts` — so editing either alone silently re-breaks it.

**Verified in the order that makes the fix mean something.** With only the two
options flipped back to BullMQ's default (`false`) and nothing else changed, the
new e2e test fails at exactly the predicted assertion — the log shows
`failure on delivery 3` reviving the row, then no fourth delivery ever arrives and
the wait for a second `recovered` times out. With them restored, 4/4 pass in that
spec, re-run to confirm. 276/276 unit tests green (271 before, +5).

**Two things learned by running it that are worth keeping**, since both are easy
to get wrong again:
- **BullMQ's `backoff` delays only retries WITHIN a job, never a new job's first
  attempt.** So a freshly-scheduled redelivery runs immediately, and the row
  passes through `pending_retry` in milliseconds rather than the ~5s the backoff
  config implies. A first draft of this test asserted that intermediate state and
  was therefore green *only while the bug was present* — exactly backwards. It now
  gates on the monotonic call count instead.
- **Outbox dispatch is at-least-once, so exact subscriber-invocation counts are
  not safely assertable.** `dispatchPendingBatch`'s
  `updateMany({where: {status: 'pending'}})` guard protects the status WRITE
  against a concurrent poll cycle, not the dispatch itself — as that method's own
  comment says. An exact `toBe(4)` here failed intermittently at 5 deliveries;
  it is now `toBeGreaterThanOrEqual`, which keeps the test decisive (pre-fix it
  stalls at 3) without pinning a number the pipeline does not promise. Note that
  #9's pre-existing `expect(auditEntries).toHaveLength(1)` assertion shares this
  exposure and is latently flaky for the same reason — not touched here, but it
  should be relaxed the same way if it ever goes red.

**`attempts` was also inconsistent, and is now fixed** — it was flagged here first
and deliberately left, then closed once #47 made it user-visible. Across episodes
the column accumulated on the failure path (`increment: 1`) but was then
*overwritten* with an absolute total that `EventRedeliveryProcessor` computed as
`thisAttempt + 1`. That arithmetic silently assumed exactly one prior delivery: true
for a pair's first episode, wrong for every later one, and worst of all for an
operator redrive, where a row reading `6` was rewritten to `2`. A number an operator
consults to judge severity going *backwards* is worse than one that is merely
approximate.

`attempts` now means total delivery attempts ever made for the pair, written only
as an increment, so the column is monotonic and the count belongs to the row rather
than to whichever job last touched it. The processor no longer computes or passes a
total at all. This produces the **identical** value for a first episode (1 original
+ 5 redeliveries = 6), so it corrects the uncovered cases without altering the one
that was covered. One caller opts out — the "outbox payload is gone" path never
invokes a subscriber, so counting it would inflate rather than correct; that opt-out
is asserted explicitly at both the unit and integration layer.

**Deliberately left open — see #47** for the operator-facing surface
(`GET /event-deliveries`, `POST /event-deliveries/:id/retry`), which needs a new
permission and therefore a seed row plus a re-seed.

---

## Domain / Business Logic

### 10. Expense approval thresholds were 10x too small — MAGNITUDE RESOLVED, business figure still OPEN
**Where:** `ExpenseAdjustmentApprovalPolicy`, `ExpenseApprovalPolicy`

**Originally filed** as "the ₦1,000,000 re-approval threshold is a guess, not
confirmed policy" — chosen by "higher than the finance-director threshold"
reasoning rather than a number Ratel-Plus specified. That business question is
still open (see the bottom of this entry). But reviewing this item turned up a
straightforward defect underneath it, in code, which is what actually got fixed.

**Both threshold constants were exactly 10x smaller than their own comments
stated**, from the same mistake — one digit short in the `<naira>_00` kobo
grouping. JS ignores numeric separators, so `50_000_00n` is the 7-digit
`5000000`, where ₦500,000 needs the 8-digit `50000000`:

| Constant | Was | Actually meant | Claimed |
|---|---|---|---|
| `ExpenseApprovalPolicy.FINANCE_DIRECTOR_THRESHOLD_MINOR_UNITS` | `50_000_00n` = ₦50,000 | `500_000_00n` | "₦500,000 in kobo" |
| `ExpenseAdjustmentApprovalPolicy.REAPPROVAL_THRESHOLD_MINOR_UNITS` | `100_000_00n` = ₦100,000 | `1_000_000_00n` | "₦1,000,000" |

**The finance-director threshold was never flagged by this item at all** — the
original entry named only the adjustment policy. It is the more consequential of
the two: `SubmitExpenseHandler` resolves the chain through
`ExpenseApprovalPolicy.resolveChain()`, and `ApproveExpenseHandler` only calls
`expense.approve()` when `isFinalApproval` is true, so **every expense from
₦50,000 to ₦500,000 was escalated to a second finance-director approval** and
sat in `pending_approval` after its department head signed off. It failed
*closed* — over-restrictive, never a bypass — so this is a wrong financial
control rather than a security hole, but it was wrong by an order of magnitude
in the single most-used approval path in the system.

**Why it shipped, which is the part worth fixing properly.** Neither policy
class was referenced by a single spec file. `approval-chain.spec.ts` and
`workflow-engine.spec.ts` both hand-construct chains via
`ApprovalChain.of([...])`, so `resolveChain()` had **never been invoked by any
test**, and its two-step branch had never executed in CI. Every existing test
amount was ₦10–₦1,500 — below even the buggy threshold — so no test could have
noticed. That is the same failure mode as #21 (an untyped, untested projection
shipping broken); a constant that only a human comment validates is the same
class of risk as a return type of `any`.

**Fixed, and pinned so it cannot recur silently:**
- Both literals corrected. Boundary semantics deliberately unchanged
  (`< THRESHOLD` for the chain, `>= THRESHOLD` for the adjustment, so *at*
  threshold escalates in both).
- Two new unit spec files (17 tests) — the first coverage either class has ever
  had. Both express every amount in **naira** via a local
  `naira = (amount: bigint) => amount * 100n` helper and convert, so the kobo
  relationship is asserted rather than implied. A bare kobo literal in a test
  would let the identical missing-digit mistake pass again, which is exactly how
  this shipped.
- Named regression pins (`sets the escalation point at ₦500,000, NOT ₦50,000`)
  so the intent is greppable from failure output rather than inferable only from
  the number.
- The exact resolved step objects are asserted, not just chain length, so a
  future widening of either chain must change an expectation deliberately —
  #21's discipline.
- Negative adjustments (the `absolute` branch, for reversals) are now covered;
  nothing touched them before.
- Two e2e tests in `expense-lifecycle.e2e.spec.ts`, including the control that
  proves the fix does something: a ₦100,000 expense sits **between** the buggy
  and the real threshold, so department-head approval alone must complete it.
  That test was written first and **observed failing** (`pending_approval`)
  against the old constant before either literal was touched. The companion test
  is the first end-to-end exercise of the two-step chain anywhere — a ₦600,000
  expense must stay `pending_approval` after its department head approves, then
  reach `approved` only once a `finance_director` does.
- Also removed `DEPARTMENT_HEAD_THRESHOLD = 0n` from `ExpenseApprovalPolicy`:
  declared, never read, and misleading because it implied a consulted threshold.

**No backfill, decided explicitly.** The chain is resolved at submit time and
persisted by `progressRepo.initialize(...)`, so expenses already in
`pending_approval` keep the 2-step chain they were given and will still require
a finance-director approval even where the corrected threshold says one step
would do. Accepted rather than migrated: no production data exists yet. If this
is ever fixed after real rows exist, those in-flight rows need an explicit
decision, not a silent re-resolve — re-resolving a chain mid-approval would
discard approvals already recorded against it.

**Still open — the original business question.** ₦500,000 and ₦1,000,000 are now
implemented faithfully, but they remain the figures *this codebase assumed*, not
ones Ratel-Plus confirmed. **To close:** confirm both with the business and
adjust the two constants (and the two spec files' expectations, deliberately).

### 10b. Only `ExpenseApprovalPolicy` branches on amount; payroll does not
**Where:** `PayrollApprovalPolicy`
**What:** Checked while fixing #10, and recorded so the asymmetry isn't mistaken
for the same bug: `PayrollApprovalPolicy` has no threshold constants at all and
resolves a single `finance_director` step regardless of run total, deliberately
("payroll's sensitivity comes from what it contains, not its size"). There was
no 10x defect to fix there. Noted only because a reader finding #10 would
reasonably wonder whether payroll shared the flaw.


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

### 21. ~~Payroll's GET :id response is shaped for a two-tier view split that isn't actually enforced~~ — RESOLVED
Took the second of the two options this item offered — simplify the response
and comment to stop implying an authorization distinction that isn't
enforced — rather than committing to a two-tier permission split, which
would have been a product decision, not a debt fix. The payslip projection
itself is unchanged (identity + gross/net, no line items): it is a narrow
projection for its own sake, the same discipline as `ColumnMappingView`, and
the comment now says that instead of hinting at a second permission tier.
Where a genuine two-tier decision would belong — a future full-line-item
endpoint — is now stated explicitly at the one place it would be made.

**A live bug was found while closing this, which is the actual reason it
mattered.** The payslip projection was written as an arrow function with a
*block* body containing labelled statements and no `return`:

```ts
payslips: run.getPayslips.map((p) => {
  const pProps = p.toProps();
  employeeId: pProps.employeeId;   // a label, not an object property
  grossPay: pProps.grossPay.toJSON();
  netPay: pProps.netPay.toJSON();
}),
```

So `GET /payroll-runs/:id` served `payslips: [undefined, undefined, …]` —
one `undefined` per payslip — for every payroll run since the endpoint was
built. Two things let it ship: the handler's return type was `any`, so
`tsc` had nothing to check the callback against, and the handler had no unit
or e2e coverage at all.

Fixed all three layers of that, not just the syntax:
- The callback returns a real object, and each payslip's `id` is now
  included (it was absent from the intended shape too — a caller had no way
  to address an individual payslip).
- The handler's return type is now an explicit `PayrollRunDetailView` /
  `PayrollRunPayslipView` instead of `any`, so the same class of mistake
  becomes a compile error rather than a silently-empty response.
- Added 6 unit tests, including one asserting the exact key set of a
  projected payslip — so a future widening of this response has to be a
  deliberate change to that expectation rather than an accident — and the
  cross-organization 404 case, which payroll's sensitivity warrants.


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

**Investigated 2026-08-21, and the attractive third option does NOT exist.**
PostgreSQL 15 (this project's version) supports `UNIQUE NULLS NOT DISTINCT`, which
would make the EXISTING constraint behave exactly as intended — no sentinel, no
table split, no reshaping. Prisma's schema language cannot express it: adding
`@@unique([userId, role, departmentId], nullsNotDistinct: true)` fails
`prisma validate` outright (checked against a throwaway copy of the schema rather
than assumed). The string appears in `@prisma/studio-core`'s driver code but not in
the schema engine.

That leaves only hand-written SQL for either `NULLS NOT DISTINCT` or the equivalent
partial index
(`CREATE UNIQUE INDEX … ON user_role_assignments (user_id, role) WHERE department_id IS NULL`).
Both are expected to fight `migrate dev`: Prisma derives the expected database state
by replaying migrations into a shadow database and diffing it against
`schema.prisma`, so an index the schema does not declare reads as drift and gets a
generated migration to drop it. That is the same trap #15 records for native
partitioning. **Caveat on this specific point:** the `prisma validate` rejection was
verified directly; the drift consequence is Prisma's documented diffing behaviour
plus #15's recorded experience, and was not separately re-run here.

**So this stays OPEN, deliberately, with no partial fix applied.** Working around
the nullable column with raw SQL that Prisma will fight is worse than the current
state, which is a seed-only quirk with **no production exposure** — reconfirmed:
`userRoleAssignment` still has only `findMany`/`findFirst` reads outside the seed
script, so nothing in the API can create a duplicate. The trigger condition this
item names has not arrived.

**Recommendation for whoever closes it:** prefer (b), the table split. Option (a)'s
sentinel keeps the nullable column and adds a lie — `departmentId` holding an
organization id — and every existing `departmentId === null` check (permission
guard, `EffectiveScopeResolver`, seed) would have to change meaning in lockstep,
which is a silent-drift risk across security-relevant code. (b) removes the nullable
column from the constraint entirely, so the DB enforces the rule natively with no
raw SQL and nothing for Prisma to fight. It is the larger change, but it is the one
that ends the problem instead of routing around it — and the right moment for it is
when the role-assignment API is built, not before.

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

### 25. ~~No file-type/content validation on CSV upload~~ — RESOLVED
`ImportController.create()` now validates every upload before it reaches
object storage, via a new `integration/domain/csv-file-validation.ts`. Two
checks, ordered by how much each can be trusted:
1. **Declared content type** — a cheap first filter only. The allowlist
   deliberately includes the ambiguous-but-legitimate values real clients
   send for a genuine `.csv` (`application/vnd.ms-excel` on Windows,
   `text/plain` from many editors, `application/octet-stream` from `curl`
   with no explicit header — which is how this project's own manual
   verification uploads files). Rejecting those would block real users while
   stopping no attacker, since the header is self-declared.
2. **Actual content** — the real gate, and the part that addresses the
   security-adjacent half of this item. Known binary signatures (PDF,
   ZIP/`.xlsx`, legacy `.xls`/`.doc`, PNG, JPEG, GIF, gzip, bzip2, RAR, ELF)
   are named specifically in the error, and anything else binary is caught by
   NUL bytes over a bounded 8KB window. This runs regardless of what the
   client claimed, so an allowed content type cannot wave binary bytes
   through.

Validation runs **before** the storage upload, so a file that can never be
parsed never occupies a bucket object, and the caller gets a specific 400
synchronously (`UnsupportedImportFileError`, a `DomainError` per critical
convention #5) instead of having to poll an `ImportJob` into `failed`.

Deliberately does NOT validate CSV *structure* — headers, column count,
delimiters. `CsvProviderAdapter` already owns that and produces better,
mapping-aware messages; duplicating it here would recreate exactly the
silent-drift risk #22/#37 closed.

Two things verified rather than assumed while building this:
- A leading UTF-8 BOM is tolerated end to end. Excel writes one, and it is
  skipped for signature matching (so a BOM can't be used to hide a `%PDF`
  header) — confirmed by test. Separately confirmed empirically that
  papaparse itself handles a leading BOM without corrupting the first header
  name, so no BOM-stripping was needed in the adapter.
- 27 unit tests plus 5 e2e tests, including a CONTROL case (a real CSV with a
  BOM must still return 201) so "reject everything" cannot pass the suite,
  and a case where PNG bytes are labelled `text/csv` to prove the declared
  type isn't load-bearing.

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

### 27. ~~`S3ObjectStorageAdapter` still lazily validates config~~ — RESOLVED
Originally two gaps in one entry; both are now closed.

The test-coverage half closed earlier: a MinIO Testcontainers module is wired
into the e2e harness (same pattern as Postgres/Redis), and
`attachments.e2e.spec.ts` exercises upload, scan and download against a real
MinIO container.

The config-visibility half is now closed too, using exactly the fix this item
prescribed rather than a bigger one: `S3ObjectStorageAdapter.onModuleInit()`
logs at boot — a `warn` naming **every** missing `OBJECT_STORAGE_*` variable
(not just the first), plus what specifically breaks as a result
("attachments and CSV import will fail on first use; every other endpoint is
unaffected"), or an informational `log` of the configured bucket/endpoint
when all four are set.

Deliberately a warning and not a `validateEnv` hard-fail: the lazy check in
`getClient()` is kept exactly as it was, so the app — and any e2e suite that
doesn't touch attachments — still boots with no object storage at all. A
boot-time hard-fail would couple every deployment to object storage being
configured, which isn't true for every deployment. The two behaviours are
complementary: visible at deploy time, still not a boot dependency.

Covered by 5 unit tests, including the two that pin the trade-off itself:
missing config must NOT throw at `onModuleInit`, and must still throw on
first actual use. Empty string is treated as unset rather than configured.

## Testing Infrastructure

### 28. ~~Unit test suite logs a Jest "worker failed to exit gracefully" warning~~ — RESOLVED
**Root cause: CPU contention in Jest's worker pool, not a leak.** Both causes
this item hypothesised were ruled out, and the actual mechanism was measured
rather than guessed:

- `--detectOpenHandles` reports **zero** open handles. (Note for anyone
  re-running it: that flag implies `--runInBand`, so it cannot reproduce a
  *worker* warning at all — it only proves nothing lingers in-process.)
- **No single spec reproduces it.** All 26 unit spec files were run
  individually; none warned.
- **It tracks worker count, not code.** `--maxWorkers` 2, 4 and 8: clean.
  15 (the default `cores - 1` on this 16-core machine): warns, deterministically
  across repeated runs.
- **Leave-one-out at 15 workers is the decisive evidence.** Omitting any of 22
  of the 26 files still warns; omitting one of 4 mutually unrelated files makes
  it disappear. That is the signature of *how work happens to be distributed
  across workers*, not of a specific file holding something open.
- Both original hypotheses are dead: `src/` contains **no** `setInterval`/
  `setTimeout` anywhere, and no unit spec loads `argon2` (only `AuthService`
  imports it, and no unit spec touches `AuthService`).

So: 15 concurrent ts-jest TypeScript compilations on 16 cores contend badly
enough that some workers miss Jest's teardown grace period and get
force-exited.

**Fix:** an absolute `maxWorkers` cap in `test/jest.unit.config.js`
(`Math.max(2, Math.min(4, cpus - 1))`) — the same treatment the integration and
e2e configs already give `maxWorkers`, for their own different reason.

**CORRECTION — the first attempt at this fix was wrong, and regressed within the
same day.** It set `maxWorkers: '50%'` (8 workers here) on the strength of a
warm-cache measurement, and the warning came back the moment three spec files
were added for #9. Re-measured properly, the trigger is a **cold ts-jest cache**,
which is what CI does on every run:

|            | cold cache      | warm cache  |
|------------|-----------------|-------------|
| 8 workers  | 37s, **WARNS**  | 14s, clean  |
| 4 workers  | 16s, clean      | 9s, clean   |

So the original claim ("a 2.3x speedup that happens to also fix the warning") was
half right: capping does speed the suite up, but 50% never fixed the warning at
all in the state that matters — it only raised the threshold until the suite grew
past it again. Fewer workers win because ts-jest compilation is
memory-bandwidth-bound, not CPU-bound, so the low cap is faster in BOTH cache
states as well as quiet.

Two lessons folded into the config: measure the **cold** path, since that is CI's
only path; and use an **absolute** cap rather than a percentage, because a
percentage silently scales with the machine and with suite size, which is exactly
how the first attempt regressed unnoticed. Floored at 2 so a small CI box isn't
fully serialized.

**This is still not `forceExit` and not masking a leak** — `--detectOpenHandles`
reports none, no single spec reproduces the warning in isolation, and `src/`
contains no timers at all. Verified: `npm test` runs 254/254 green with zero
warnings, cold (17s) and warm (7s).

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

### 38. ~~Async attachment scan jobs can race against e2e test cleanup~~ — RESOLVED
**Where:** e2e test teardown/setup boundary, `AttachmentScanProcessor`
**What was happening:** `cleanE2eDatabase()` in `beforeEach` truncates
`attachments`, so a scan job still in flight from the PREVIOUS test updated a row
that no longer existed — a caught, logged, retried-to-permanent-failure Prisma
`P2025`. It failed no test (the orphaned scan failed against a target correctly
gone) but it put misleading errors into the output of whichever test happened to
run next, which matters more than it sounds when reading a genuine failure.

**Fixed by draining, plus removing the cause.** `attachments.e2e.spec.ts` now has
an `afterEach` that waits for every attachment to leave `scanStatus: 'unscanned'`
before the next test's truncation. Drained in `afterEach` rather than `beforeEach`
so the wait is attributed to the test that actually created the work.

The root enabler was also removed: this file slept a **fixed `setTimeout(5000)`
twice** while waiting for scans. That is the same latent flake commit `f714ba1`
had just replaced in the CSV import spec — a hard-coded wait fires whenever the
suite gets busier, and when 5s proved insufficient the scan outlived its test,
which is precisely how this race occurred. Both are now polled to a terminal
`scanStatus` via a `waitForScanToSettle` helper mirroring that commit's
`waitForJobToSettle`, so the tests are deterministic and 10s of unconditional
sleeping is gone.

The drain **warns rather than throws** on timeout, deliberately: this is cleanup
hygiene, not an assertion. A genuinely wedged scanner should surface as the
scan-dependent tests failing on their own assertions, not as an opaque teardown
error on every test in the file. It does not stay silent either — silence is how
the original noise went unexplained — so the count of unsettled scans is reported.

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

### 43. ~~Saved column mappings can be created and listed, but never deleted~~ — RESOLVED
`DELETE /imports/column-mappings/:id` added, gated on the same
`expense:create` permission as the rest of the import surface.

**Hard delete, decided explicitly** — this item asked for that decision to be
made rather than assumed, so: critical convention #3 (soft delete) exists so
an `Expense`/`Payslip` can never reference a row that vanished. A
`ColumnMapping` is referenced by nothing. `ImportJob.resolvedMapping`
*snapshots* the mapping's content at upload time and holds no FK back to this
table, so deleting a mapping cannot re-explain or damage a historical import
job's parse. There is nothing here for a soft delete to protect, and an
`isActive` column would add a filter that every read path (list,
resolve-at-upload) must remember — one miss and a "deleted" mapping is
silently usable again. This is a documented exception to convention #3, not
drift; the reasoning is repeated in the handler so it can't be mistaken for
an oversight at the code.

The delete is scoped by `organizationId` **in the same statement** as the id
(`deleteMany({ where: { id, organizationId } })`, then `count === 0` → 404),
rather than fetch-then-delete: no window in which the ownership check and the
delete can disagree, and "not yours" is indistinguishable from "doesn't
exist" so the endpoint can't be used to probe which IDs exist elsewhere.

Renaming, also named in this item, is now possible as save-under-new-name +
delete-old. A dedicated rename endpoint was not added — with upsert-by-name
plus delete, it would be pure sugar.

Covered by 3 unit tests and 6 e2e tests, including the one that proves the
hard-delete reasoning rather than just asserting it: an import job processed
with a mapping still reports `completed` with its `resolvedMapping` snapshot
intact after that mapping is deleted. Also covered: a deleted `mappingId`
becomes unusable for a later upload (gone from the list is not the same as
gone), and another organization's mapping returns 404 **and still exists
afterwards**.

### 44. ~~A whole-file import failure records no reason the API can return~~ — RESOLVED
Added `ImportJob.failureReason String?` (migration
`20260819105302_add_import_job_failure_reason`), populated in
`ImportJobProcessor`'s fetch/parse catch block alongside the existing
server-side log, and returned from `GET /imports/:jobId`.

Log AND column, not one or the other: the log keeps the full context for an
engineer, the column gives the API something specific to return. A caller who
uploads a file with the wrong headers now gets back
`"Missing required column(s): department, category, …"` and can fix it
themselves, instead of `status: "failed"` with the reason reachable only by
someone with log access.

Nullable rather than defaulted, deliberately: a populated `failureReason` must
mean a whole-file failure actually happened. Row-level failures are unchanged
— they stay in `FailedImportRecord` via `GET /imports/:jobId/errors`, and
`failureReason` stays null for them.

The column is also **cleared on each attempt**, at the `processing` transition
rather than only written on failure. The same `ImportJob` row can legitimately
be processed more than once — an operator re-enqueueing it, or a queue
redelivery, which is the path the Inbox pattern exists for and which the e2e
suite already exercises. Without clearing, a job that failed and then
succeeded on a later attempt would report `completed` while still carrying the
previous attempt's reason, which reads as authoritative and is worse than
having no reason at all.

Verified by extending the existing e2e CONTROL case (the non-canonical file
uploaded with no `mappingId`, which was already asserting only
`status: 'failed'`): it now also asserts the reason names the missing columns,
and that `GET :jobId/errors` is still `[]` — the per-row/whole-file split
that made this gap exist in the first place. Plus two new controls: that
`failureReason` is null on a successful import, so a populated value means
something failed rather than just that the column exists, and that a planted
reason from a prior attempt is gone after the same job is re-enqueued.

Also confirmed against the live docker-compose stack: a file with
non-canonical headers and no mapping now returns
`"Missing required column(s): department, category, amountMinorUnits,
currency, expenseDate. Save a column mapping if your file uses different
header names."` from `GET /imports/:jobId`, with `/errors` still `[]` — the
exact gap this item described.

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

## Tooling

### 46. ~~`npm run lint` runs, and its config is now correct, but `src` is not yet clean~~ — RESOLVED
All 63 errors and 5 warnings closed (the count moved from the last entry's
62 to 63 between then and this pass — one additional `any` had entered the
codebase in the interim; not investigated further since the fix applies
uniformly regardless of count).

**Every `any` replaced with a real type, not suppressed.** The dominant
pattern (repositories, application handlers, reporting) was casting to a
genuine Prisma-generated type — enums (`RoleName`, `ExpenseStatus`,
`PayrollRunStatus`, `PeriodStatus`, `ApprovalDecision`), model types
(`Employee`, `Department`, `Vendor`, `Project`, `ExpenseCategory`,
`NotificationLog`), or `Prisma.<Model>WhereInput` — rather than a blanket
`as any`. A handful needed something more specific: `permission.guard.ts`
and `prisma-effective-scope.resolver.ts` now cast role arrays to `RoleName`;
`request-context.middleware.ts` uses a minimal structural `RequestLike`
interface instead of importing a Fastify type this file was never confident
matched what Nest actually passes; `problem-details.filter.ts`'s three
`any`s were replaced with a genuine `hasMessage()` type guard rather than a
cast, which is arguably better code than what was there, not just quieter.

**A real Prisma gotcha, discovered and then reused deliberately.**
`AuditLogService`'s nullable `oldValue: Json?` column rejected a bare `null`
at the type level — Prisma requires `Prisma.DbNull` (a genuinely absent SQL
value) to be distinguished from `Prisma.JsonNull` (a stored JSON `null`
token) precisely because the two are different at the database level. The
first attempt at silencing this cast `null` through `as unknown as X`,
which compiled but left the code claiming a type it never actually produced
at runtime — caught and corrected before merging, not left in. The same
gap existed a second time, independently, in `ImportController`'s
`resolvedMapping` — both now use `Prisma.DbNull` for a genuine absence.

**Two of the fixes changed real behaviour, not just satisfied the linter,
and are recorded separately from the mechanical majority:**
- `PayrollRun.totalGrossPay()` and `Payslip.generate()` both called
  `Money.zero(currency as any)`, which bypasses `Money`'s own
  `isSupportedCurrency` check entirely — an unchecked cast was silently
  authorizing an unchecked value. Both now call `Money.of(0n, currency)`,
  which produces the identical zero value but validates the currency code,
  so an unsupported currency now correctly throws `InvalidCurrencyError`
  (itself only reachable as a proper 400 since #50) instead of silently
  succeeding.
- Several `QueryHandler`s returning `any[]`/`any` now return the actual
  Prisma row type they always produced. This is a type-honesty fix with a
  known, deliberately-not-fixed-here side effect: several of these
  (`Employee`, `NotificationLog`, and others) now visibly return
  `organizationId` in their response type — the same echo-back pattern
  `#22`/`#47` closed for `ColumnMappingView`/`EventDeliveryView`, not
  addressed for these handlers in this pass since it's a response-shape
  decision, not a lint fix. Worth its own item if closed later.

**Verification order matters here more than usual**, since two of the
fixes above are real behaviour changes disguised as a typing pass: full
build, full lint, then the complete suite (unit, integration, e2e) — not
build+lint alone, specifically because a currency-validation tightening or
a `DbNull` change could pass a type check while silently breaking a test
that relied on the old, looser behaviour. All green.

The two rules the original entry singled out as worth enabling —
`no-unused-expressions` (which would have caught #21's actual bug) and
`no-unused-vars` (which caught 6 real dead imports/types in this very
pass, including one leftover from #23) — earned their keep directly during
this sweep, not just in principle.


---

## Event Pipeline — Follow-ups

### 47. ~~No operator-facing surface for failed event deliveries~~ — RESOLVED
`GET /event-deliveries` (filterable by status), `GET /event-deliveries/:id` and
`POST /event-deliveries/:id/retry` now exist in a new `src/event-deliveries/`
module — a top-level supporting module beside `NotificationsModule`, **not** a
bounded context: failed deliveries are event-pipeline bookkeeping with no
aggregate, state machine or business rules, so full DDD layering would be ceremony.
Gated on a new `event-delivery:manage` permission, seeded for `accountant` and
`finance_director` (the roles that already hold `notification:manage`, this item's
closest precedent). Retry goes through the SAME `EVENT_DELIVERY_RETRY_SCHEDULER`
port the dispatcher uses, so a manual redrive and an automatic one cannot drift.

**The org-scoping question this item raised is settled by denormalizing.**
`failed_event_deliveries` now carries `organizationId`, written at record time from
the outbox payload. `NOT NULL` with an `"unknown"` default rather than nullable,
matching what `AuditSubscriber` already does for the identical question
(`payload['organizationId'] ?? 'unknown'`) — two different answers to the same
question inside one event pipeline would be the silent-drift risk #22/#37 closed.
A sentinel and not a throw because recording a failure must never itself fail,
which is the whole point of #9: an unattributed record beats a lost one. The
default also made the column safe to add to a table with existing rows with no
separate backfill. It is re-asserted on UPDATE as well as CREATE, so a row created
before the column existed gets attributed the next time that pair fails instead of
staying permanently unlistable.

Verified: all 17 event factories across the three contexts do include
`organizationId`, so the sentinel is a guard rather than a common path — checked
before committing to `NOT NULL`, not assumed.

Decisions worth recording, each having had a defensible alternative:
- **A `pending_retry` retry returns 409, not success.** A live BullMQ job already
  exists for that row under `redeliver-<id>`, so a second enqueue would be
  deduplicated and the operator told "requeued" while nothing happened. Here the
  dedupe is CORRECT, so refusing is the honest answer — absorbing it would
  reintroduce precisely the silent no-op corrected under #9.
- **Enqueue before the status write.** If the enqueue throws, the row still says
  `permanently_failed`, which is true. The reverse order would leave a row claiming
  `pending_retry` with no job in existence and nothing to correct it. The other
  direction is self-correcting: the worker resolves the row on completion anyway.
- **Responses go through an explicit `EventDeliveryView`**, not the raw Prisma row,
  so `organizationId` isn't echoed back to a caller that already knows it (#22's
  reasoning). Asserted as an exact key set, so widening it must be deliberate (#21).
- **Status filter validated at the boundary**, not passed to Prisma raw: an unknown
  value would surface as a Prisma client error, which `ProblemDetailsFilter` can
  only render as a useless 500 (critical convention #5). Now a specific 400 naming
  the valid values.
- **`auditor` deliberately NOT granted.** A permanently-failed `AuditSubscriber`
  delivery genuinely is an auditor's concern, but this single `:manage` permission
  bundles reading with redriving, and redelivery is an operational action rather
  than an audit one. If read-only visibility for auditors is wanted, the right move
  is splitting into `event-delivery:view` / `event-delivery:retry`, not widening
  this grant.

Covered by 13 e2e tests, 3 integration and 2 unit. The e2e set includes the
controls that make a pass mean something: a 403 for a role without the permission
(so a 200 cannot be explained by the guard never running), cross-organization 404s
that also assert the target row was left **untouched**, and a status-filter control
proving the filter filters rather than being ignored.

One residual gap, stated rather than hidden: a row whose organization is `"unknown"`
appears in no organization's list and is therefore reachable only via logs and psql
— a narrow re-creation of the very gap this item closed. It requires an event whose
payload omits `organizationId`, which none currently do. The audit log has had the
identical property since #7b for the same reason, so this is a consistent
consequence of the sentinel rather than a new inconsistency.

**Two prerequisites had to be cleared first** (both recorded under #9's
CORRECTION): the retry-scheduler port was provided by `JobsModule` but never
exported, so no outside caller could inject it; and the retry would have been a
guaranteed silent no-op, because the BullMQ jobId derives from the failure row id
and finished jobs were retained in Redis under it. Without that second fix this
endpoint would have returned `{requeued: true}` and done nothing.

---

## Financial Period — Lifecycle

### 48. ~~A closed period could never be reopened, permanently stranding in-flight records~~ — RESOLVED
**Where:** `src/contexts/financial-period/` — `ReopenPeriodHandler`,
`ListPeriodsHandler`, `GetPeriodByIdHandler`, and their command/query/DTO/route.
**What was broken:** closing a period is enforced by **nine** call sites across
Expense and Payroll (submit/approve/reject/cancel, add-payslip/submit/approve/
reject), every one throwing `PeriodClosedError` once the period is not open.
Nothing could undo a close. So an expense sitting in `pending_approval` when its
period closed could be neither approved **nor** rejected — stranded permanently,
through entirely ordinary use (close the month, then find an expense nobody got
to). `FinancialPeriod.reopen()` and `PeriodStatus.reopened` already existed, and
`OPEN_STATUSES` already included `'reopened'`; only the application path to them
was missing, so all nine call sites started working again with **no changes
outside this context**.

**The reason is required, and required in three places on purpose.** It is on
`ReopenPeriodDto` (`@IsString @IsNotEmpty @MaxLength(500)`), on
`ReopenPeriodCommand`, and re-checked inside `FinancialPeriod.reopen()`. Not
redundancy: `@IsNotEmpty` rejects `''` but treats `'   '` as present, so the
aggregate's `trim()` is what actually closes that gap, and the aggregate owns the
invariant for any future route that doesn't come through this DTO. The trimmed
value is what reaches the event, so a reason cannot be whitespace-padded into
meaninglessness.

**Why the reason lands on the `PeriodReopened` payload specifically:** verified
against the code rather than assumed — `AuditSubscriber` (registered globally)
lifts `payload['reason']` into `AuditLogService.record({ reason })`, which writes
the audit entry's own `reason` column, and `'reopenedById'` is already in that
subscriber's `ACTOR_KEYS`, so it also populates `actorUserId`. Putting both on the
payload is therefore the entire implementation of "reopening a closed financial
period is always attributable and always has a stated cause" — zero audit-side
code, which is the Conformist subscriber's whole point.

**Decisions worth recording, each having had a defensible alternative:**
- **Reopen reuses `period:open`, no new permission.** Reopening is the same
  authority as opening, and inventing `period:reopen` would have required a seed
  row plus a `prisma:seed` re-run (critical convention #2) to grant nobody any
  capability they didn't already have. Confirmed `period:open` is seeded for
  `finance_director` at `organization` scope.
- **`PeriodReopenReasonRequiredError extends DomainError`**, not bare `Error`,
  so `ProblemDetailsFilter` renders a real 400. A bare `Error` here would have
  surfaced the whitespace-only case as a useless 500 (critical convention #5).
- **Discovery had to be built alongside reopen, not deferred.** `findCurrentOpen`
  matches `OPEN_STATUSES` only, so `GET /financial-periods/current` can never
  return a **closed** period — exactly the id a reopen needs. Without `GET
  /financial-periods` (+ status filter) and `GET /:id`, reopen would have been an
  endpoint whose only input was unobtainable through the API.
- **`GET /:id` is declared after `GET /current`** deliberately — route matching
  is order-sensitive, and a `':id'` registered first swallows `/current` and
  treats it as a period id.
- **Cross-organization reads and writes return 404, not 403**, resolved via a new
  `findByIdForOrganization` that puts both predicates in one query rather than
  fetch-then-compare. "Not yours" is indistinguishable from "does not exist", so
  the endpoints can't enumerate foreign period ids (#43's reasoning).

**Coverage:** 27 unit tests across the aggregate, `ReopenPeriodHandler`, and the
two query handlers, plus 11 e2e cases (the spec now holds 13 — #49 added the other
two, and its own 5 unit tests, when it org-scoped close). All green against real
Postgres + Redis + MinIO + ClamAV via Testcontainers. The e2e test that carries the
weight
asserts the **stranding first** — the 409 on both approve *and* reject while
closed — so a passing reopen afterwards cannot be explained by the expense having
been approvable all along. Also covered: a 403 for a role without `period:open`
(so a 201 can't be explained by the guard never running), a cross-org 404 that
additionally asserts the foreign period was left **untouched**, and the audit
assertion checking `reason`, `newValue.reopenedById` **and** `actorUserId`
end-to-end through the real outbox poller.

### 49. ~~`ClosePeriodHandler` is not organization-scoped, though its command implies it is~~ — RESOLVED
**What it was:** `ClosePeriodCommand` took `organizationId` as its first
constructor argument and `ClosePeriodHandler.execute()` **never read it**. The
lookup was `repo.findById(cmd.periodId, tx)` with no organization predicate, so any
caller holding `period:close` could close **another organization's** period by id —
a cross-tenant write. The parameter looked load-bearing and was not, the same
failure mode #3 removed the decorative `scope` argument from `@RequirePermission`
for. Found while building #48's reopen path, which deliberately did not repeat it.

**Fixed** by switching the lookup to
`findByIdForOrganization(cmd.periodId, cmd.organizationId, tx)` — the port method
#48 had already added, so close and reopen now resolve periods identically and the
asymmetry between them is gone. Both predicates go in one query rather than
fetch-then-compare, so there is no window in which the ownership check and the read
can disagree, and "not yours" is indistinguishable from "does not exist" (#43's
reasoning) — cross-organization close returns 404, not 403.

**`findById` was audited and deliberately kept, not deleted.** The close-out note
on this item suggested removing it so the unscoped lookup couldn't be reintroduced
by habit, but it has one legitimate remaining caller: `PeriodStatusAdapter.isOpen()`,
which fetches and then compares `period.organizationId !== organizationId` itself.
That is safe — it returns a boolean and mutates nothing — so deleting the method
would have meant rewriting a correct call site for no behavioural gain. The port's
doc comment now says this explicitly and directs new write-preceding lookups to the
scoped method instead, which is the durable version of the same protection. The one
integration spec that exercises `findById` directly is likewise untouched.

**Coverage:** an e2e regression test closes an **open** foreign period and asserts
404 — open specifically, because the old unscoped `findById` would have found it and
returned 201, so the test fails against the previous code for the right reason. It
then asserts the foreign period is untouched on `status`, `closedAt` **and**
`closedById`: a partially-applied close that wrote the metadata while leaving the
status alone would be worse than a wrong status, and only those assertions catch it.
A positive control sits in the same describe block (own-organization close still
returns 201 and records `closedById`), so the 404 cannot be read as close having
broken for everyone (#3b's reasoning).

Also added the **first unit spec `ClosePeriodHandler` has ever had** (5 tests). Its
having none is why a decorative constructor argument survived unnoticed for this
long — worth noting as the actual root cause rather than just fixing the symptom.
The scoping test asserts both that the scoped lookup was called and that
`findById` was **not**, since checking only the former would still pass if someone
reinstated the unscoped call alongside it.

### 50. ~~`InvalidPeriodDatesError` extends bare `Error`, not `DomainError`~~ — RESOLVED
**What it was:** a violation of critical convention #5. `FinancialPeriod.create()`
throws `InvalidPeriodDatesError` when `endDate <= startDate`, and because it wasn't
a `DomainError` subclass it fell through `ProblemDetailsFilter`'s final branch.

**The consequence was worse than the wrong status code**, which is worth recording
because the original entry understated it. That fallback branch does not merely
default to 500 — it replaces the message with the fixed string `'An unexpected error
occurred'`. So `POST /financial-periods` with a reversed date range returned a 500
that told the caller nothing at all about what was wrong with their request, even
though the domain had produced a perfectly clear message. Verified by reading
`problem-details.filter.ts` rather than assumed.

**Fixed** by extending `DomainError` with `code = 'invalid-period-dates'` and
`httpStatus = 400`. The explicit `this.name = ...` assignments were dropped
throughout — `DomainError`'s constructor already sets `this.constructor.name`.

**The sibling audit this item asked for was done, and it found three more.** All
nine bare-`Error` subclasses in `src` were traced to their throw sites and call
paths:

*Fixed, because they are HTTP-reachable and were producing the same swallowed 500:*
- `NetPayExceedsGrossPayError` (`payslip.entity.ts`) → 400 `net-pay-exceeds-gross-pay`.
  `Payslip.generate()` is called from `AddPayslipHandler`, so this discarded the
  "check deduction totals" hint the message exists to give.
- `InvalidCurrencyError` (`money.vo.ts`) → 400 `unsupported-currency`. Reachable
  through `POST /expenses`: `CreateExpenseDto` validates `@Length(3, 3)` but **not**
  that the code is one of `NGN/USD/EUR/GBP`, so any other three-letter code reaches
  `Money.of()`. Confirmed by reading the DTO and `currency-code.ts` together — this
  is ordinary bad input, not a contrived case.

*Correctly left bare, with the reasoning already documented in-tree at
`domain-event-dispatcher.ts:31-39`* — these are wiring/programmer errors raised at
module init or inside a background worker, where there is no HTTP response to render
into: `DuplicateSubscriberNameError`, `UnknownSubscriberError`, `CsvParseError`.
`CsvRowValidationError` and `ImportMappingError` are likewise correct: both are
caught at `import-job.processor.ts:115` and recorded as per-row import failures, so
they never reach the filter.

*One left open as a genuine design question:* `CurrencyMismatchError` — see #51.

**Coverage:** three e2e regression tests, each asserting the RFC 7807 `type` and
`detail` rather than only the status, since a status-only assertion could pass for
the wrong reason. A reversed date range returns 400 `invalid-period-dates` and
persists nothing; an unsupported currency returns 400 `unsupported-currency` naming
`XYZ`; and a positive control opens a period with a valid range (nothing else in
that spec exercised `POST /financial-periods` at all — every other period is
inserted through Prisma directly). Full suite green: 303 unit, 36 integration, 88
e2e.

Note the tests were **not** observed failing against the old code — that the
`.expect(400)` would have failed is read directly off the filter's fallback branch
returning 500, which is unambiguous, rather than demonstrated by a run.

### 51. ~~`CurrencyMismatchError` is a bare `Error`, and its correct status is a real question~~ — RESOLVED
Took option (a) from this item's own analysis: `CurrencyMismatchError` now
extends `DomainError` with `httpStatus: 500` — the status stays honest
(this is a programmer error: application code added two different
currencies together, not something a client caused), but
`ProblemDetailsFilter` now renders the real message instead of discarding
it into the generic `'An unexpected error occurred'` fallback.

**No e2e test was added, deliberately, not by oversight.** Every call site
of `Money.add()` in the codebase was traced: `PayrollRun.totalGrossPay()`
is the only real caller, and `AddPayslipHandler` hardcodes a single
currency for every payslip in a run, so there is currently no path through
the API that constructs two different-currency `Money` values and adds
them. With multi-currency support itself not yet started, fabricating an
HTTP path just to claim e2e coverage would misrepresent what the system
can actually do today. Covered instead by 3 unit tests asserting the
`DomainError` shape (`instanceof` check, `code`/`httpStatus`/`message`
values, and the same-currency non-throwing case) — the correct and honest
level of coverage for a currently-unreachable defensive invariant.

**Closes the audit #50 opened.** All nine bare-`Error` subclasses found in
`src` have now been resolved: five converted to `DomainError`
(`InvalidPeriodDatesError`, `NetPayExceedsGrossPayError`,
`InvalidCurrencyError` under #50; `CurrencyMismatchError` here), and four
correctly left bare with their reasoning already documented in-tree
(`DuplicateSubscriberNameError`, `UnknownSubscriberError`, `CsvParseError`,
plus `CsvRowValidationError`/`ImportMappingError`, which are caught and
recorded as per-row import failures before ever reaching an HTTP response).


---

*Last updated: 2026-08-22. Most recently: **closed #51** —
`CurrencyMismatchError` now extends `DomainError` (500,
`currency-mismatch`), taking the option #50's audit recommended: keep the
status honest (a programmer error, not client-caused) but stop discarding
the real message into the generic fallback text. No e2e test was added —
traced every `Money.add()` call site and found none reachable through the
API today, since `AddPayslipHandler` hardcodes a single currency per run
and multi-currency support hasn't started; fabricating a path would have
misrepresented coverage, so this is unit-tested only, honestly. This
closes out the full audit #50 opened: all nine bare-`Error` subclasses in
`src` are now accounted for — five converted, four correctly left bare
with their reasoning already in-tree.*

*Earlier: 2026-08-21 — **closed #49** — `ClosePeriodHandler`
resolved its period with the unscoped `findById` and never compared the
`organizationId` its command had always carried, so `period:close` could close
another organization's period. Now goes through `findByIdForOrganization`, the same
lookup #48's reopen uses, ending the asymmetry between the two. `findById` was
audited and **kept**: `PeriodStatusAdapter.isOpen()` is a legitimate caller that
does its own org comparison on a read-only boolean, so the port comment now directs
new write-preceding lookups to the scoped method instead of deleting a method a
correct call site still needs. Covered by an e2e regression test that closes an
**open** foreign period (open specifically — the old code would have returned 201),
asserts 404, and checks the row is untouched on `closedAt`/`closedById` as well as
`status`, plus a same-block positive control and the first unit spec the handler has
ever had — its having none is why the decorative argument survived unnoticed. One
**transient e2e failure** was observed during this verification: two tests in the
unrelated `event-delivery-operator` spec failed on a `loginAs` 401, then passed
85/85 on an immediate re-run and 13/13 in isolation. Root cause was not
established, so no production change was made and no item was filed.*

*Earlier the same day: **closed #48** — the financial-period
reopen path, plus the period-discovery endpoints (`GET /financial-periods` with a
status filter, `GET /:id`) that reopen is unusable without, since `GET /current`
matches open statuses only and so can never surface the closed period id a reopen
needs. The reopen **reason is required** at the DTO, the command, and the aggregate:
`@IsNotEmpty` treats `'   '` as present, so the aggregate's `trim()` is the check
that actually holds, and the trimmed value is what reaches the `PeriodReopened`
payload. It lands on the payload because `AuditSubscriber` already lifts
`payload['reason']` into the audit entry's `reason` column and already has
`reopenedById` in its `ACTOR_KEYS` — verified by reading both, so the reason and
the actor are recorded with zero audit-side code. Reuses `period:open` rather than
adding a permission, so no re-seed is required. Also **filed #49** (`ClosePeriodHandler`
accepts an `organizationId` and never compares it, so close is **not** org-scoped
while the new reopen is — found while deliberately not repeating it, and silent
until multi-tenancy makes it a real cross-tenant write) and **#50**
(`InvalidPeriodDatesError` still extends bare `Error`, so a reversed date range
degrades to a 500 instead of a 400). Both were referenced in code comments as
"tracked separately" before any such entry existed; the comments now name the item
numbers.*

*Earlier the same day: **investigated #14** and applied no partial fix — PostgreSQL
15 supports `UNIQUE NULLS NOT DISTINCT`, which would fix the constraint in place,
but Prisma's schema language cannot express it (`prisma validate` rejects
`nullsNotDistinct`, checked directly against a throwaway schema copy). See that
entry for why raw SQL Prisma will fight is worse than the current seed-only quirk.*

*Previously: 2026-08-20 — **closed #47** (operator API over failed
event deliveries, in a new `src/event-deliveries/` supporting module, with
`organizationId` denormalized onto the table and an `"unknown"` sentinel matching
`AuditSubscriber`'s existing handling of the same question) and **#38** (attachment
scan jobs now drained before e2e cleanup, and the two fixed `setTimeout(5000)`
sleeps that caused the overrun replaced with settle-polling). Also **fixed the
`attempts` counter**, which #47 turned from a latent inconsistency into a
misleading API response: it was overwritten with an absolute total the processor
derived as `thisAttempt + 1`, so an operator redriving a row reading `6` watched it
drop to `2`. It is now written only as an increment, making it monotonic, with one
explicit opt-out for the path that never invokes a subscriber. **#46's config half
is fixed** — the missing `^_` ignore patterns were penalising the codebase's own
convention, and the real count is 62 errors / 5 warnings, not 65; the typing sweep
itself stays open as its own piece.*

*Earlier the same day: **corrected #9** — its automatic
redelivery only ever worked for a pair's FIRST failure. The BullMQ `jobId` is
derived from the failure row's id, which is stable across failure episodes (the
table is upserted on its unique pair), and finished jobs were retained in Redis
under it, so every enqueue after the first was a silent no-op. The row dutifully
returned to `pending_retry` — which `recordFailures` does on purpose — and then
sat there with no job to move it. Found by reading the dedupe key while scoping
#47, not by any test: all of #9's e2e coverage and its manual verification
exercised exactly one failure episode per pair. Fixed with
`removeOnComplete`/`removeOnFail`, proven by an e2e test observed failing at the
predicted assertion with only those two options reverted. Also documented two
run-only findings — BullMQ's backoff never
delays a new job's first attempt, and outbox dispatch is at-least-once, so exact
subscriber-invocation counts are not safely assertable.*

*Earlier the same day: after fixing #10 — both expense approval threshold
constants were exactly 10x smaller than their own comments stated (`50_000_00n`
is ₦50,000, not ₦500,000), so every expense from ₦50,000 to ₦500,000 was
wrongly escalated to a second finance-director approval. Found by reading the
constants while reviewing #10, not by any test: neither `ExpenseApprovalPolicy`
nor `ExpenseAdjustmentApprovalPolicy` was referenced by a single spec, and
`resolveChain()` had never been invoked in CI. Fixed both literals and added the
first coverage either class has had (17 unit tests + 2 e2e), with the e2e control
observed failing against the old constant before anything was changed. The
business figures themselves remain unconfirmed — #10 stays open for that. Filed
#10b so payroll's deliberate lack of amount branching isn't mistaken for the same
bug. Also **corrected #46**, which claimed no ESLint config existed anywhere;
`eslint.config.mjs` landed in `b4af661` and the real remaining work is 65 errors /
5 warnings, inflated by a missing `argsIgnorePattern: '^_'`.*

*Previously: 2026-08-19, after closing #9 (per-subscriber delivery failure
tracking + automatic redelivery — including two bugs found only by running it: a
BullMQ `jobId` colon restriction that silently prevented every retry from being
enqueued, and an `attempts` under-count on permanently-failed rows). Filed #47
for the operator-facing retry surface deliberately left open. Also **corrected
#28**, whose first fix was calibrated on a warm-cache measurement and regressed
the same day — the real trigger is a cold ts-jest cache, which is CI's only path.
Earlier the same day: #21, #25, #27, #43, #44, and #46 filed for a completely
broken `npm run lint`.*