# Development Phases & Design Decisions

This document records the architectural reasoning, business assumptions, design decisions, trade-offs, risks, and important discoveries made throughout the development of the Ratel-Plus Financial Platform.

The purpose is not only to document what was built, but also **why it was built that way**. Future architectural changes should be evaluated against the decisions and constraints documented here.

---

# Phase 1: Business Analysis

## 1.1 What We're Actually Building

Stripping away the feature list, this system is **not simply an expense tracker with payroll bolted on**.

It is the **financial system of record for Ratel-Plus Nigeria Ltd.**

The platform will eventually become the foundation against which future financial capabilities such as:

- General Ledger (GL)
- Double-entry accounting
- Budgeting
- Multi-currency accounting
- Multi-company support
- ERP integrations
- Advanced financial analytics

will need to reconcile.

This reframing has significant consequences for the architecture.

The system must prioritize:

1. **Financial correctness**
2. **Auditability**
3. **Data integrity**
4. **Traceability**
5. **Consistency**
6. **Controlled state transitions**
7. **Long-term extensibility**

over short-term feature velocity.

Even though the current scope is limited to:

- Expense Management
- Payroll
- Expense Tracking
- Financial Reporting
- Audit and Compliance

the underlying architecture must not prevent the system from eventually becoming a more complete financial platform.

### Critical Lesson From BED-6C

This principle has already been demonstrated through the problems encountered in **BED-6C, the Ledger System**.

In that project, **13 out of 20 handlers produced entries that appeared numerically balanced but were directionally incorrect**.

This is an especially dangerous class of financial bug because:

- the database remains internally consistent;
- debit and credit totals can still balance;
- basic tests may pass;
- the resulting numbers look legitimate;
- but the financial meaning is wrong.

The underlying lesson is that **numerical balance is not sufficient to establish financial correctness**.

This risk must therefore be addressed at the domain level through explicit financial invariants, directional rules, domain-level validation, and stronger testing strategies.

This will be revisited explicitly during **Phase 2: Domain Modeling**, because it represents one of the highest-risk areas of the platform.

---

## 1.2 Core Business Capabilities

The initial business capabilities were analyzed to determine whether they should become bounded contexts, read-side concerns, or cross-cutting infrastructure capabilities.

| Capability | Scope | Architectural Interpretation | Notes |
|---|---|---|---|
| Expense Management | Now | Bounded Context | Core aggregate: `Expense`, with an explicit lifecycle |
| Payroll | Now | Bounded Context | Separate context due to different cadence, sensitivity, and business rules |
| Expense Tracking | Now | Read/Query Concern | Primarily a read-model and querying problem rather than a separate write-side capability |
| Financial Reporting | Now | Read-Side Capability | Expected to require CQRS-style read models as data volume grows |
| Audit & Compliance | Now | Cross-Cutting Infrastructure | Not a bounded context; every domain context depends on it |
| Integration Layer | Now, Architecturally | Architectural Seam | Thin initially, but must exist even while CSV/manual ingestion is the primary mechanism |
| Double-Entry Accounting / GL | Future | Future Bounded Capability | Architecture must leave room for this from the beginning |
| Multi-Currency | Future / Partially Relevant Now | Data-Model Concern | Currency and exchange-rate concepts should be introduced early |
| Multi-Company / Multi-Tenancy | Future | Data-Model Concern | `organization_id` should exist from the beginning even if tenant switching is not initially exposed |

---

## 1.3 Assumptions Being Challenged

### 1.3.1 Expense Management and Payroll Are Not Equivalent Contexts

Although both Expense Management and Payroll represent money leaving the organization, they should **not** be treated as equivalent bounded contexts.

Payroll has fundamentally different characteristics:

- Payslip immutability
- Salary confidentiality
- Statutory deduction requirements
- Different approval requirements
- Different processing cadence
- Different access-control requirements
- Higher sensitivity of personally identifiable financial information

Salary information is among the most sensitive data in the platform.

Therefore:

> **Payroll will be modeled as its own bounded context rather than as a variant of the Expense Management workflow.**

The two contexts may share certain infrastructure and financial concepts, but their domain rules must remain isolated.

Payroll should have its own approval workflow and lifecycle rather than inheriting the Expense Management workflow merely because both involve financial transactions.

---

### 1.3.2 External Systems Must Not Write Directly Into the Core Domain

The principle of preventing external systems from directly modifying the core domain is retained.

However, an important distinction must be made between an **adapter** and an **Anti-Corruption Layer (ACL)**.

An adapter translates technical transport concerns.

An ACL translates **meaning**.

For example:

- A CSV bank statement may describe a transaction one way.
- A VOS3000 API response may represent the same business event differently.
- An email invoice may contain yet another representation.

These sources cannot be assumed to share the same definition of a `Transaction`, `Expense`, or `Payment`.

Therefore, external integrations must be isolated behind:

```text
External System
      |
      v
   Adapter
      |
      v
Anti-Corruption Layer
      |
      v
Domain Command / Domain Model
      |
      v
Core Domain
```

## Phase 2: Domain Modeling

### 2.1 Bounded Context Map

```text
┌─────────────────────┐     ┌─────────────────────┐
│  Expense Management │     │       Payroll        │
│  (bounded context)  │     │  (bounded context)  │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           │      consumes/emits       │
           ▼                           ▼
   ┌───────────────────────────────────────────┐
   │      Workflow & Approval Framework        │
   │         (shared kernel — see 2.2)         │
   └───────────────────────────────────────────┘
           │                           │
           ▼                           ▼
   ┌───────────────┐           ┌───────────────────┐
   │  Audit Trail  │◄──────────┤ Financial Period  │
   │ (cross-cutting)│           │ / Close Management│
   └───────────────┘           └───────────────────┘
           ▲
           │ (read models, denormalized)
   ┌───────────────────────┐
   │  Reporting / Tracking │  ← query-side only, no writes
   └───────────────────────┘
           ▲
           │ (ACL-mediated)
   ┌───────────────────────┐
   │   Integration Layer   │  ← CSV/PDF/Email/API adapters
   └───────────────────────┘
```

Four true bounded contexts:

1. **Expense Management**
2. **Payroll**
3. **Financial Period**
4. **Integration**

Two cross-cutting infrastructure capabilities that no context owns exclusively:

* **Audit**
* **Workflow Framework**

And one pure read-side context:

* **Reporting / Tracking**

Reporting has **no domain logic of its own**. It only projects data into read models.

---

### 2.2 The Shared Workflow & Approval Framework

This is the piece your answer just promoted to first-class.

It needs to be a genuine **shared kernel**: a small, stable, rarely-changing module both contexts depend on, expressed abstractly enough that Payroll's "salary band + finance director" approval chain and Expense's "amount threshold + department head" chain are both just *configurations* of it, not forks of it.

#### Core Abstractions

| Concept                           | Responsibility                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Approvable` (interface/contract) | Anything with a state machine that needs approval implements this. `Expense` and `PayrollRun` both do.                       |
| `ApprovalPolicy`                  | Pure domain logic: given an `Approvable` + its context (amount, requester, department), returns the required approval chain. |
| `ApprovalChain`                   | Ordered/branching set of `ApprovalStep`s. Supports sequential, parallel, and escalation-on-timeout later.                    |
| `WorkflowEngine`                  | Orchestrates transitions, delegates *policy decisions* to `ApprovalPolicy`, and never hardcodes business rules itself.       |
| `WorkflowEvent`                   | Domain event emitted on every transition. This is what both Audit and the state machines subscribe to.                       |

Critically: the **state machine transitions** (`Draft → Submitted → Approved → ...`) live in the framework; the **policy** (who must approve, in what order, for what amount) is injected per-context.

This is the same separation you used well in BE-6B's template system and BED-6D's YAML-driven workflow engine. Reusing that instinct here directly.

---

### 2.3 Expense Management — Domain Model

**Aggregate root:** **`Expense`**

| Field              | Type                    | Notes                                                                                                 |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`               | UUID                    |                                                                                                       |
| `organizationId`   | UUID                    | Baked in now per Phase 1 decision                                                                     |
| `expenseNumber`    | String                  | Human-readable, sequential per org                                                                    |
| `status`           | `ExpenseStatus` (enum)  | Draft, PendingApproval, Approved, Rejected, Cancelled, Closed, Adjusted                               |
| `source`           | `ExpenseSource` (VO)    | Manual, Employee, Accountant, Import, Integration — captures *creation source* from your requirements |
| `amount`           | `Money` (VO)            | See 2.3.1                                                                                             |
| `category`         | `ExpenseCategory` (ref) | Maps toward future chart-of-accounts                                                                  |
| `vendor`           | `VendorRef` (nullable)  |                                                                                                       |
| `department`       | `DepartmentRef`         |                                                                                                       |
| `project`          | `ProjectRef` (nullable) |                                                                                                       |
| `periodId`         | FK → `FinancialPeriod`  | Determines mutability rules                                                                           |
| `attachments`      | `AttachmentRef[]`       | Receipts/invoices — stored via File Storage context                                                   |
| `parentExpenseId`  | UUID (nullable)         | **New** — links an adjustment to the original expense it corrects                                     |
| `adjustmentReason` | String (nullable)       | Required when `parentExpenseId` is set                                                                |

#### Value Objects

* `Money` — `{ amount: bigint (minor units), currency: CurrencyCode }`. Storing minor units as integers (kobo, not naira-float) is non-negotiable. You already know this from the PayFlow Orchestration BIGINT-paise decision. Reused here directly.
* `ExpenseSource` — `{ type: enum, actorId, importJobId?, integrationId? }`
* `AuditableChange` — not stored on `Expense` itself, but the shape every mutation emits toward the Audit context.

#### Key Invariant

The following invariant is enforced by the aggregate, **not the service layer**:

> An `Expense` whose `periodId` refers to a **closed** `FinancialPeriod` cannot transition to any state via direct mutation. The *only* legal operation is `createAdjustment()`, which produces a **new** `Expense` with `parentExpenseId` set and an inverse-signed amount, in the *current open* period.

This directly encodes the period-close answer at the domain layer, not as an application-service check that's easy to forget in one of eighteen handlers (BED-6D pattern) or twenty transaction handlers (BED-6C pattern).

**Domain-layer enforcement > service-layer discipline, every time.**

That's the lesson from BED-6C's polarity bug, generalized.

#### Domain Events Emitted

* `ExpenseDrafted`
* `ExpenseSubmittedForApproval`
* `ExpenseApproved`
* `ExpenseRejected`
* `ExpenseCancelled`
* `ExpensePeriodClosed`
* `ExpenseAdjustmentCreated`

---

### 2.4 Payroll — Domain Model

Separate aggregate roots, deliberately not inheriting from `Expense`. They share the **`Approvable` contract**, not a class hierarchy.

**Aggregate root:** **`PayrollRun`**

| Field                              | Type                                                  | Notes                                                              |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `id`, `organizationId`, `periodId` |                                                       | Same period-close rules apply                                      |
| `status`                           | `PayrollRunStatus`                                    | Draft, PendingApproval, Approved, Processing, Completed, Cancelled |
| `payslips`                         | `Payslip[]` (child entities, not separate aggregates) | Payslips only exist inside a run's transactional boundary          |

#### Entity: `Payslip`

`Payslip` is a child entity of `PayrollRun`.

| Field                                              | Notes                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `employeeId`                                       |                                                                                                                         |
| `salaryStructureSnapshot`                          | **Snapshot, not reference** — salary structure changes next month must never retroactively alter a historical payslip   |
| `allowances[]`, `deductions[]`, `loanRepayments[]` | Line items, each a VO                                                                                                   |
| `taxPlaceholder`                                   | `TaxComputation` VO — currently a passthrough/no-op, shaped so a real tax engine can implement the same interface later |
| `netPay`                                           | `Money`                                                                                                                 |

#### Why `PayrollRun` and Not `Payslip` as the Aggregate Root?

Payroll approval happens at the run level. The finance director approves the whole month's payroll, not employee-by-employee.

Therefore, the transactional/consistency boundary should match the approval boundary.

This mirrors the reasoning you already applied when choosing transaction as the consistency boundary in the payment orchestration layer.

#### `SalaryStructure`

A separate value object:

**`SalaryStructure`** — versioned, effective-dated, lives independently of any run, referenced (and *snapshotted*) by payslips at generation time.

#### Sensitivity

The sensitivity requirement carried forward from Phase 1 remains in effect.

`Payslip` and `SalaryStructure` fields containing compensation data should be flagged for **field-level encryption at rest**, reusing the AES-256-GCM envelope encryption pattern from BED-6D rather than reinventing it.

---

### 2.5 Financial Period — The Context I've Promoted to First-Class

Your answer to the immutability question effectively created a new bounded context you hadn't named:

**Financial Period / Close Management**

**Aggregate root:** **`FinancialPeriod`**

| Field                                    | Notes                           |
| ---------------------------------------- | ------------------------------- |
| `organizationId`, `startDate`, `endDate` |                                 |
| `status`                                 | Open, Closing, Closed, Reopened |
| `closedBy`, `closedAt`                   |                                 |

This context owns the single rule that both Expense and Payroll depend on:

> **"Can this record be mutated, or only adjusted?"**

Both other contexts query it, or better, cache a denormalized `isOpen` flag they subscribe to via `PeriodClosed` domain event. They never own the concept themselves.

This is also exactly the seam that later becomes **"period close"** in a full GL.

---

### 2.6 Audit — Cross-Cutting, Not a Context

Every domain event above (`ExpenseApproved`, `PayslipGenerated`, `PeriodClosed`, etc.) is the Audit Trail's **only input**.

I'd carry forward your BED-6D hash-chained audit trail design here unmodified:

* Event-sourced audit log
* Hash-chained for tamper-evidence
* Subscribes to domain events
* Never called imperatively from services

This avoids the classic failure mode where someone adds a new mutation path and forgets to call `auditLog.record()`.

---

### 2.7 Domain Event Catalog (So Far)

```text
Expense:
  Drafted
  SubmittedForApproval
  Approved
  Rejected
  Cancelled
  AdjustmentCreated

Payroll:
  RunCreated
  RunSubmittedForApproval
  RunApproved
  RunProcessed
  PayslipGenerated

Period:
  Opened
  Closing
  Closed
  Reopened

Workflow:
  StepApproved
  StepRejected
  ChainEscalated (future)
```

---

## Transition to Phase 3

Before Phase 3, **Bounded Context Integration Contracts**, the next architectural question is how these contexts communicate without coupling.

Examples include:

* Should Payroll listen to `PeriodClosed` through an in-process event bus?
* Should the event be published asynchronously through the transactional outbox?
* Which events are internal domain events versus integration events?
* Which context owns the contract?
* Where should translation occur?
* What consistency guarantees are required between contexts?

I want to confirm the **transactional/messaging boundary** before moving into Phase 3, since it determines a significant portion of the module structure in Phase 4.

## Phase 3: Bounded Context Contracts & Integration Patterns

### 3.1 Contract Types Between Contexts

Not all inter-context communication should look the same. Three distinct patterns are chosen deliberately per relationship:

| Relationship                       | Pattern                                                        | Why                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expense/Payroll → Financial Period | **Open-Host Service + Published Language** (synchronous query) | "Is this period open?" is a read, needed *before* a command is even attempted (e.g. reject at the API boundary, don't even enter a workflow). Querying synchronously here is correct — an event-only model would let a user start editing a closed-period expense and only find out after submitting. |
| Financial Period → Expense/Payroll | **Domain Events (async, via outbox)**                          | `PeriodClosing` → contexts get a *reactive* chance to finish in-flight work; `PeriodClosed` → contexts flip their cached "closed" flag. This is "notify," not "ask," so async is correct.                                                                                                             |
| Expense/Payroll → Audit            | **Domain Events only, one-way**                                | Audit is a pure subscriber. It never talks back. This is a **Conformist** relationship by design — Audit conforms entirely to whatever events upstream contexts emit; it defines no policy of its own.                                                                                                |
| Integration Layer → Expense        | **Anti-Corruption Layer** (command, translated)                | External data never becomes an `Expense` directly. An adapter translates a `RawImportRecord` into a `CreateExpenseCommand` through an explicit mapping layer — see 3.3.                                                                                                                               |
| Expense/Payroll → Reporting        | **Event-Carried State Transfer** → materialized read models    | Reporting subscribes to the same domain events as Audit, but instead of appending to an immutable log, it *projects* into denormalized query tables. Two independent subscribers to the same event stream, doing very different things with it.                                                       |

---

### 3.2 The `FinancialPeriod` Query Contract (Open-Host Service)

Because this is queried synchronously and frequently (every mutation checks it), it needs a stable, narrow, deliberately boring interface. This is the textbook **Open-Host Service**:

```typescript
// shared-kernel/financial-period/period-status.port.ts

export interface PeriodStatusPort {
  isOpen(
    organizationId: string,
    periodId: string,
  ): Promise<boolean>;

  currentOpenPeriod(
    organizationId: string,
  ): Promise<PeriodRef>;
}
```

Expense and Payroll depend only on this **port** (hexagonal architecture — dependency points inward toward the abstraction, not at the Financial Period module's internals).

The concrete adapter can start as a direct repository call (same DB, same transaction even) and later become an HTTP or event-sourced cache-based implementation without either consuming context changing a line of code.

---

### 3.3 Integration Layer — Anti-Corruption Layer Detail

This is worth being precise about, because "adapter" alone under-specifies it.

There are three distinct layers, not one:

```text
External Source (CSV / PDF / Email / VOS3000 API / Bank Statement)
        │
        ▼
┌───────────────────────┐
│   Provider Adapter    │  ← transport concern only: fetch/parse raw bytes
│   (one per source)    │     into a provider-specific DTO
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│      Normalizer       │  ← provider DTO → RawImportRecord
│                       │     (a single canonical shape, provider-agnostic)
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ Anti-Corruption Layer │  ← RawImportRecord → CreateExpenseCommand
│       (Mapper)         │     enforces domain invariants, rejects malformed data,
│                       │     assigns category/vendor via lookup or "uncategorized"
└───────────┬───────────┘
            ▼
   Expense Aggregate (via normal command handler — same path
   a human-submitted expense takes, no privileged bypass)
```

The non-negotiable rule:

> **An imported expense enters the domain through the exact same command handler and invariant checks as a manually created one.**

No import-only shortcut that skips validation.

That's how BE-6B's 22 stub-template bug class happens again, except worse, because it would be silently corrupting financial data instead of shadowing a template.

Each provider gets its own `ProviderAdapter` + `Normalizer` pair. They never share code beyond the common `RawImportRecord` output contract.

This is deliberate duplication.

Provider-specific parsing logic that looks similar today (for example, two CSV adapters) will diverge as edge cases accumulate. Premature sharing there creates exactly the kind of coupling that made the PayFlow gateway adapters worth keeping separate too.

---

### 3.4 Idempotency & Import Recovery Contract

Given that **Import Recovery** and **Replay Mechanisms** were explicit requirements, each import job needs:

* `importJobId` — stable identifier for the whole batch.
* `sourceRecordHash` — deterministic hash of the raw record (before normalization), used as an idempotency key so replaying a job doesn't double-create expenses.
* An **Inbox** table on the receiving side (mirroring the Outbox on the publishing side) recording `(importJobId, sourceRecordHash)` pairs already processed. This is checked before the ACL mapper runs.

This reuses the Inbox/Outbox symmetry you already specified in your own requirements list, applied concretely rather than left abstract.

---

### 3.5 Context Map Summary (DDD Relationship Types, Named Explicitly)

| Upstream           | Downstream       | Relationship                           |
| ------------------ | ---------------- | -------------------------------------- |
| Financial Period   | Expense, Payroll | Open-Host Service / Published Language |
| Expense, Payroll   | Audit            | Conformist (Audit conforms fully)      |
| Expense, Payroll   | Reporting        | Event-Carried State Transfer           |
| Integration Layer  | Expense, Payroll | Anti-Corruption Layer                  |
| Workflow Framework | Expense, Payroll | Shared Kernel                          |

---

### 3.6 Phase 3 Conclusion

Phase 3 is where the contracts stabilize.

This is roughly the **point of no return before code**, since Phase 4 (**System Architecture / Module Layout**) and Phase 6 (**Database Design**) both build directly on these contracts.

The goal at this stage is not to have implemented the contexts, but to have established **how they are allowed to communicate**.

Once these boundaries are accepted, implementation should follow the contracts rather than introducing ad hoc dependencies between modules.

### Shared-Kernel Boundary

The **Workflow & Approval Framework** is a deliberately narrow shared kernel between the Expense Management and Payroll bounded contexts.

The shared kernel owns **approval mechanics**, not **approval policy**.

It owns:

* `Approvable`
* `ApprovalPolicy` contract
* `ApprovalChain`
* `ApprovalStep`
* `WorkflowEngine`
* `WorkflowEvent`
* Generic workflow state-transition mechanics
* Sequential and parallel approval execution
* Escalation and timeout mechanics

It does **not** own:

* Expense-specific approval rules
* Payroll-specific approval rules
* Department-specific authorization rules
* Salary-band rules
* Amount thresholds
* Context-specific state machines beyond the generic approval mechanics
* Expense or Payroll domain entities
* Financial rules belonging to either bounded context

The boundary is therefore:

```text
                  Workflow & Approval
                     Shared Kernel
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
       Expense Context          Payroll Context
              │                       │
              ▼                       ▼
   ExpenseApprovalPolicy     PayrollApprovalPolicy
              │                       │
              └───────────┬───────────┘
                          ▼
                    ApprovalPolicy
                       contract
```

The key architectural rule is:

> **The shared kernel defines how approval is executed; each bounded context defines why, when, and by whom approval is required.**

A change to an Expense approval policy should therefore require changes only within the Expense context. A change to a Payroll approval policy should require changes only within Payroll.

Changes to the shared kernel should be rare and should represent genuinely generic workflow behavior required by **both** contexts.

If a proposed feature is needed by only one bounded context, it does **not** belong in the shared kernel merely because it could technically be reused later.

This keeps the shared kernel intentionally small and prevents it from becoming a disguised "common domain" module containing unrelated business logic.

## Phase 4: System Architecture

### 4.1 Architectural Style — Decision & Justification

**Hexagonal Architecture (Ports & Adapters) within a Modular Monolith, organized by DDD bounded context.**

Comparing the alternatives you listed, briefly, because "why" matters more than "what":

| Style                                        | Verdict                                                       | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layered (traditional MVC-style)              | Rejected                                                      | Layers organized by technical concern (controllers/services/repositories) rather than business capability — leads to "fat services" where Expense and Payroll logic bleed into each other over time. Exactly the failure mode DDD/hexagonal avoids.                                                                                                                                                                                                                                                                                                                                                  |
| Pure Clean Architecture (concentric circles) | Absorbed, not separate                                        | Hexagonal *is* Clean Architecture's dependency rule (dependencies point inward, domain has zero framework dependencies) with a more concrete vocabulary (ports/adapters) that maps cleanly onto NestJS's module system. I'm using the terms interchangeably going forward — no meaningful difference for this build.                                                                                                                                                                                                                                                                                 |
| Microservices                                | Rejected for now                                              | Covered in Phase 3 — solo engineer, no independent-scaling need yet. Revisit only when a specific context has a genuinely different scaling/deployment cadence than the rest (Payroll batch processing is the most likely first candidate, years out).                                                                                                                                                                                                                                                                                                                                               |
| Event Sourcing (full, as system of record)   | **Rejected for the write model; partially adopted for Audit** | Full event sourcing means the *only* durable truth is the event stream, and current state is always derived. That's powerful but adds real complexity (snapshotting, replay performance, schema evolution of events) that this domain doesn't need — a normalized relational write model with an append-only audit log gives you 90% of the auditability benefit with a fraction of the operational complexity. The Audit Trail itself, however, *is* effectively event-sourced (hash-chained, append-only, replayable) — so you get event sourcing exactly where it earns its keep, not everywhere. |
| CQRS (full, separate read/write stores)      | **Partial adoption**                                          | Write side stays as normal Postgres tables (`Expense`, `PayrollRun`, etc.). Read side (Reporting/Tracking) uses materialized views / denormalized projection tables fed by domain events, in the *same* Postgres instance initially. This is "CQRS-lite" — logical separation of read/write models without the operational cost of a second datastore. A dedicated analytics DB (Phase 6) is a later, additive step, not a day-one requirement.                                                                                                                                                      |

---

### 4.2 Final Technology Stack

| Layer            | Choice                                               | Why (vs. alternatives you offered)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/Language | TypeScript, Node.js                                  | Matches your demonstrated strength (BE-6B through BED-6D) and the ecosystem below.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Framework        | **NestJS + Fastify adapter**                         | Same reasoning as BED-6D: Nest's module system maps directly onto bounded contexts, its DI container makes hexagonal ports/adapters natural (bind an interface to an implementation per module), and Fastify gives real throughput headroom over Express for the reporting/query-heavy paths. Express is not competitive here — no compelling reason to switch away from what's already proven across four prior assessments.                                                                                                   |
| ORM              | **Prisma**                                           | Chosen over TypeORM for the same reasons it worked in BED-6D and BE-6B: superior migration ergonomics, generated types reduce a whole class of mapping bugs, and its `$transaction` API is a clean fit for the Unit-of-Work pattern each command handler needs. TypeORM's Active Record option is actively dangerous for a domain-driven design (it encourages fat entities with persistence logic mixed into domain logic) — Prisma keeps persistence firmly at the infrastructure edge, which hexagonal architecture demands. |
| Database         | **PostgreSQL 15+**                                   | Non-negotiable for this domain: need for partitioning (large expense history), JSONB (flexible workflow policy config), strong constraint/check support (financial invariants at the DB layer as a second line of defense behind domain invariants), and native support for the advisory locks you've used successfully in PayFlow and the ledger system. MySQL offers nothing here that outweighs losing those.                                                                                                                |
| Cache / Queue    | **Redis + BullMQ**                                   | Redis for period-status caching (3.2's port) and rate limiting; BullMQ scoped specifically to background jobs per the Phase 3 decision — payroll run processing, import job execution, notification delivery, scheduled reconciliation.                                                                                                                                                                                                                                                                                         |
| Encryption       | AES-256-GCM envelope encryption (reused from BED-6D) | Applied to `SalaryStructure` and `Payslip` compensation fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Observability    | OpenTelemetry → Prometheus/Grafana                   | Standard, framework-agnostic instrumentation; avoids vendor lock-in.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Java/Spring Boot | **Not used**                                         | No justification to introduce a second language/runtime into a solo-maintained system. Spring Boot's strengths (mature enterprise ecosystem, JVM tooling) don't offset the cost of context-switching for the only engineer on this project across a 10-year horizon.                                                                                                                                                                                                                                                            |

---

### 4.3 Module Layout — Mapping Bounded Contexts to NestJS Modules

```text
src/
├── contexts/
│   ├── expense/
│   │   ├── domain/                 ← pure TS, zero framework/NestJS imports
│   │   │   ├── aggregates/         (Expense)
│   │   │   ├── value-objects/      (Money, ExpenseSource, ...)
│   │   │   ├── events/             (ExpenseApproved, ...)
│   │   │   └── ports/              (ExpenseRepository interface, PeriodStatusPort)
│   │   ├── application/            ← use cases, orchestration, no HTTP/DB knowledge
│   │   │   ├── commands/            (CreateExpense, ApproveExpense, ...)
│   │   │   ├── queries/             (GetExpenseById, ...)
│   │   │   └── handlers/
│   │   ├── infrastructure/         ← adapters: implements domain ports
│   │   │   ├── persistence/         (PrismaExpenseRepository)
│   │   │   ├── events/              (OutboxEventPublisher)
│   │   │   └── adapters/            (PeriodStatusHttpAdapter or in-proc adapter)
│   │   ├── presentation/           ← controllers, DTOs, guards
│   │   │   ├── expense.controller.ts
│   │   │   └── dto/
│   │   └── expense.module.ts
│   │
│   ├── payroll/                    ← identical internal shape to expense/
│   ├── financial-period/           ← identical internal shape
│   └── reporting/                  ← query-only: application + infrastructure
│                                    (read-projections) + presentation,
│                                    NO domain aggregates (it has no
│                                    write-side invariants of its own)
│
├── shared-kernel/
│   ├── workflow/                   ← Approvable, ApprovalPolicy, WorkflowEngine (2.2)
│   ├── audit/                      ← subscribes to all domain events, hash-chain
│   │                                  (BED-6D pattern reused)
│   ├── money/                      ← Money VO, CurrencyCode — genuinely shared,
│   │                                  not duplicated per context
│   └── outbox/                     ← generic outbox table + dispatcher,
│                                      used by every context
│
├── integration/
│   ├── adapters/                   ← one folder per provider
│   │                                  (csv, pdf-invoice, email-parser,
│   │                                   vos3000, ...)
│   ├── normalizers/
│   ├── acl/                        ← RawImportRecord → domain commands (3.3)
│   └── inbox/                      ← idempotency tracking (3.4)
│
├── infra/
│   ├── prisma/                     ← schema.prisma, migrations
│   ├── redis/
│   └── config/                     ← per-environment config, feature flags
│
└── main.ts
```

**The dependency rule that makes this hexagonal, not just "organized folders":**

`domain/` never imports from `application/`, `infrastructure/`, or `presentation/` — not even NestJS decorators.

`application/` may import `domain/` but not `infrastructure/` or `presentation/`.

This is enforced with an ESLint boundary rule (`eslint-plugin-boundaries` or a custom dependency-cruiser config), not just convention.

Convention alone is how BE-6B's stub-template shadowing bug survived until an audit caught it.

**Enforce architecturally what you can't rely on catching by review alone.**

---

### 4.4 Cross-Cutting Concerns

* **API Versioning:** URI versioning (`/api/v1/expenses`) — simplest to reason about, easiest to document in OpenAPI, and Nest supports it natively via `URI Versioning` in the app config. Header-based versioning adds complexity with no real benefit at this scale.

* **Feature Flags:** A simple `feature_flags` table + Redis cache, read through a `FeatureFlagPort` — deliberately not a third-party service (LaunchDarkly etc.) yet; that's an easy later swap behind the same port.

* **Configuration Management:** `@nestjs/config` with Zod-validated schema per module (fail fast on missing/malformed env vars at boot, not at first request) — this also gives you a natural seam for per-tenant configuration later (Phase 1's multi-tenancy groundwork).

* **Scheduler:** `@nestjs/schedule` for cron-style jobs (scheduled reconciliation, period auto-close reminders), delegating actual work to BullMQ jobs rather than running long work inline in the cron handler.

## Phase 5: Module Architecture

### 5.1 Command/Query Separation — Implementation Pattern

I'd avoid pulling in `@nestjs/cqrs` wholesale — its event bus and saga abstractions are more machinery than a modular monolith needs, and it obscures the outbox-based event flow decided in Phase 3/4. Instead: a **lightweight, explicit CQRS-lite** built from plain interfaces, so the pattern stays visible and debuggable.

```typescript
// shared-kernel/cqrs/command-handler.ts
export interface CommandHandler<TCommand, TResult> {
  execute(command: TCommand): Promise<TResult>;
}
```

```typescript
// shared-kernel/cqrs/query-handler.ts
export interface QueryHandler<TQuery, TResult> {
  execute(query: TQuery): Promise<TResult>;
}
```

Each is just a NestJS injectable bound in the module's providers — no bus indirection, no magic string-based dispatch. A controller calls a specific handler by DI token, which is easier to trace, test, and debug than an event-bus-mediated command dispatch, especially for a solo maintainer who will be reading this code again in year 6.

**Commands mutate and return only IDs/acknowledgement. Queries read, never mutate, and hit the projection tables (2.5/4.2) rather than the write-model aggregates wherever a projection exists.**

The CQRS lifecycle is therefore deliberately simple:

```text
COMMAND SIDE
Controller
    ↓
Command Handler
    ↓
Domain Aggregate
    ↓
Write Model + Outbox Event
    ↓
Transaction Commit

                    ↓

EVENT / PROJECTION SIDE
Outbox Dispatcher
    ↓
Domain Event
    ↓
Projection Handler
    ↓
Read/Projection Table

                    ↓

QUERY SIDE
Controller
    ↓
Query Handler
    ↓
Projection Table
    ↓
Response
```

The important boundary is that **commands never update projection tables directly, and queries never mutate the write model**.

Projection updates are eventually consistent. A successful command transaction does not wait for the reporting projection to update. If projection processing fails, the event is retried until the read model catches up.

The projection is therefore a **derived, replaceable read model**, not another source of business truth.

### 5.2 The Application/Use-Case Layer — Anatomy of One Command End-to-End

Walking `ApproveExpense` through every layer, because this is where all the prior phases' decisions actually meet:

```typescript
// application/commands/approve-expense.command.ts
export class ApproveExpenseCommand {
  constructor(
    readonly expenseId: string,
    readonly approverId: string,
    readonly organizationId: string,
  ) {}
}
```

```typescript
// application/handlers/approve-expense.handler.ts
@Injectable()
export class ApproveExpenseHandler
  implements CommandHandler<ApproveExpenseCommand, void>
{
  constructor(
    private readonly expenseRepo: ExpenseRepository,      // port, domain-defined
    private readonly periodStatus: PeriodStatusPort,      // port, from shared kernel
    private readonly workflowEngine: WorkflowEngine,       // shared kernel
    private readonly unitOfWork: UnitOfWork,               // port
  ) {}

  async execute(cmd: ApproveExpenseCommand): Promise<void> {
    return this.unitOfWork.transaction(async (tx) => {
      const expense = await this.expenseRepo.findById(cmd.expenseId, tx);
      if (!expense) throw new ExpenseNotFoundError(cmd.expenseId);

      // Domain invariant check — delegated to Financial Period via port (3.2)
      const isOpen = await this.periodStatus.isOpen(
        cmd.organizationId,
        expense.periodId,
      );

      if (!isOpen) throw new PeriodClosedError(expense.periodId);

      // Policy decision delegated to shared workflow framework (2.2)
      const result = this.workflowEngine.recordApproval(
        expense,
        cmd.approverId,
      );

      // expense.applyApproval(...) — mutation happens INSIDE the aggregate,
      // enforcing its own invariants, not in this handler

      await this.expenseRepo.save(expense, tx);
      await this.unitOfWork.enqueueOutboxEvents(
        expense.pullDomainEvents(),
        tx,
      );

      return result;
    });
  }
}
```

Three things to notice, because each maps back to a decision from Phases 2–4:

1. **The handler orchestrates; it does not decide.** Whether the expense *can* be approved is the aggregate's and the workflow engine's job. The handler's only logic is sequencing: check period, delegate approval, persist, publish. This is the exact discipline BED-6C's directional-polarity bug violated — logic that belongs in the domain lived in individual handlers instead, so it was inconsistent across 20 of them. Centralizing invariant enforcement in the aggregate makes that class of bug structurally harder to reintroduce.

2. **Domain events are pulled from the aggregate, not raised ad hoc.** `expense.pullDomainEvents()` returns everything the aggregate recorded internally during `applyApproval()` (e.g., `ExpenseApproved`). The handler never manually constructs an event — that would let the event and the actual state change drift apart.

3. **The outbox write happens in the same transaction as the state mutation** (`unitOfWork.transaction(...)` wraps both). This is what makes the Phase 3 outbox pattern actually durable — if the process crashes between saving the expense and writing the event, in this design neither happened; there's no window where the state changed but no event was recorded (or vice versa).

### 5.3 Repository Pattern — Port Definition Lives in Domain, Not Infrastructure

```typescript
// domain/ports/expense-repository.port.ts
export interface ExpenseRepository {
  findById(id: string, tx?: Transaction): Promise<Expense | null>;
  findBySpecification(
    spec: Specification<Expense>,
    page: Pagination,
  ): Promise<Page<Expense>>;
  save(expense: Expense, tx: Transaction): Promise<void>;
}
```

The interface is a domain artifact — it speaks in domain language (`Expense`, `Specification<Expense>`), with zero Prisma types leaking through. The Prisma implementation lives in `infrastructure/persistence/`, translating `Expense` ⇄ Prisma models at the boundary. This is what actually makes hexagonal architecture testable: application-layer tests can inject an in-memory fake `ExpenseRepository` and never touch Postgres.

### 5.4 Specification Pattern — For Complex, Reusable Query Predicates

Given "searchable" tracking (department, vendor, project, status, source, date range, all in combination) was an explicit requirement, ad hoc `WHERE` clause construction in query handlers becomes unmaintainable fast. A Specification composes:

```typescript
// domain/specifications/expense-specifications.ts
export const byDepartment = (
  deptId: string,
): Specification<Expense> => ({...});

export const byDateRange = (
  from: Date,
  to: Date,
): Specification<Expense> => ({...});

export const byStatus = (
  status: ExpenseStatus,
): Specification<Expense> => ({...});

// composable:
const spec = byDepartment(deptId)
  .and(byDateRange(from, to))
  .and(byStatus('Approved'));
```

The Prisma repository implementation translates a `Specification<Expense>` tree into a Prisma `where` clause via a visitor — one translation function, reused for every query, rather than each query handler hand-rolling Prisma filter objects (which is also how N+1s and missed-index queries creep in unnoticed).

### 5.5 Factory Pattern — Aggregate Construction with Enforced Invariants

Aggregates should never be constructible via a public constructor that skips invariant checks (e.g., accidentally instantiating an `Expense` with a negative amount in a test or an import path). A static factory is the single legal entry point:

```typescript
export class Expense {
  private constructor(props: ExpenseProps) {
    /* ... */
  }

  static create(cmd: CreateExpenseProps): Expense {
    // all invariants enforced here: amount > 0, currency valid, etc.
    const expense = new Expense({
      ...cmd,
      status: 'Draft',
    });

    expense.recordEvent(new ExpenseDrafted(expense.id));
    return expense;
  }

  static createAdjustment(
    original: Expense,
    reason: string,
  ): Expense {
    // enforces: only from a closed-period original,
    // inverse amount, links parentExpenseId
  }

  static reconstitute(props: ExpenseProps): Expense {
    // used ONLY by the repository when loading from DB — bypasses "new" invariants
    // since a persisted record is assumed already valid at creation time
  }
}
```

The `reconstitute` vs. `create` split matters: loading from the database is a different concern from creating new business state, and conflating them is a common source of accidentally re-running creation-time validation against historical data that predates a rule change.

### 5.6 Strategy Pattern — Where It Actually Earns Its Keep Here

Two genuine strategy-pattern candidates in this domain, not manufactured ones:

* **`TaxComputation`** (Payroll) — interface with a `NoOpTaxStrategy` today, swappable for a real Nigerian PAYE engine later without touching `Payslip` or `PayrollRun` at all.
* **`ApprovalPolicy`** (2.2) — different strategies per context (`ExpenseApprovalPolicy` threshold-based, `PayrollApprovalPolicy` role-based) implementing the same interface the shared `WorkflowEngine` consumes.

I'd resist reaching for Strategy elsewhere just because the pattern list mentions it — e.g., `Money` arithmetic or `Vendor` lookup don't need strategy indirection; that's the kind of over-engineering that makes a codebase harder for future-you to navigate, not easier.

### 5.7 Error Handling Convention (feeds into Phase 7's RFC 7807 design)

Domain errors are typed exceptions (`PeriodClosedError`, `ExpenseNotFoundError`, `InvalidApprovalStateError`) thrown from the domain/application layer, each carrying a stable error code. A single NestJS exception filter at the presentation edge maps these to RFC 7807 Problem Details responses — domain code never constructs HTTP status codes itself, keeping `domain/` and `application/` completely transport-agnostic per the hexagonal dependency rule from 4.3.

## Phase 6: Database Design

### 6.1 Entity-Relationship Diagram

```text
ORGANIZATION
    │
    ├── has ──→ DEPARTMENT
    │
    ├── has ──→ FINANCIAL_PERIOD
    │              │
    │              ├── constrains ──→ EXPENSE
    │              └── constrains ──→ PAYROLL_RUN
    │
    ├── employs ──→ EMPLOYEE
    │
    ├── owns ──→ VENDOR
    │
    ├── owns ──→ PROJECT
    │
    └── owns ──→ EXPENSE_CATEGORY

EXPENSE
    ├── belongs to ──→ FINANCIAL_PERIOD
    ├── paid to ──→ VENDOR
    ├── charged to ──→ PROJECT
    ├── categorized as ──→ EXPENSE_CATEGORY
    ├── has ──→ ATTACHMENT
    ├── requires ──→ APPROVAL_STEP
    ├── adjusts ──→ EXPENSE (self-reference)
    └── sourced from ──→ IMPORT_JOB

PAYROLL_RUN
    ├── runs for ──→ FINANCIAL_PERIOD
    ├── contains ──→ PAYSLIP
    └── requires ──→ APPROVAL_CHAIN

PAYSLIP
    ├── belongs to ──→ EMPLOYEE
    └── snapshots ──→ SALARY_STRUCTURE

IMPORT_JOB
    ├── uses ──→ INTEGRATION_PROVIDER
    └── records ──→ INBOX_RECORD

OUTBOX_EVENT
    └── emits ──→ DOMAIN_EVENT

AUDIT_LOG_ENTRY
    └── records ──→ DOMAIN_EVENT
```

### 6.2 Core Table Definitions

#### `financial_periods`

```sql
CREATE TABLE financial_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          period_status NOT NULL DEFAULT 'open',  -- enum: open, closing, closed, reopened
  closed_by       UUID REFERENCES users(id),
  closed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_period_dates CHECK (end_date > start_date),
  CONSTRAINT uq_org_period UNIQUE (organization_id, start_date, end_date)
);

CREATE INDEX idx_periods_org_status
  ON financial_periods (organization_id, status);
```

The `chk_period_dates` check constraint is a deliberate second line of defense — the domain layer enforces this too (Phase 2/5), but a DB-level CHECK means even a raw migration script or a future engineer bypassing the application layer can't insert a physically nonsensical period. This mirrors the directional-balance-assertion discipline from BED-6C: don't rely on application code alone for financial invariants that the database can enforce for free.

#### `expenses` — the largest, highest-write-volume table, designed for partitioning from day one

```sql
CREATE TABLE expenses (
  id                   UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id),
  expense_number       VARCHAR(32) NOT NULL,
  status               expense_status NOT NULL DEFAULT 'draft',
  source_type          expense_source_type NOT NULL,       -- manual|employee|accountant|import|integration
  source_actor_id      UUID,
  source_import_job_id UUID REFERENCES import_jobs(id),
  amount_minor_units   BIGINT NOT NULL,                    -- kobo, never float — BED-6C/payflow lesson reused
  currency             CHAR(3) NOT NULL DEFAULT 'NGN',
  category_id          UUID NOT NULL REFERENCES expense_categories(id),
  vendor_id            UUID REFERENCES vendors(id),
  department_id        UUID NOT NULL REFERENCES departments(id),
  project_id           UUID REFERENCES projects(id),
  period_id            UUID NOT NULL REFERENCES financial_periods(id),
  parent_expense_id    UUID REFERENCES expenses(id),       -- adjustment linkage (Phase 2.3)
  adjustment_reason    TEXT,
  expense_date         DATE NOT NULL,
  description          TEXT,
  deleted_at           TIMESTAMPTZ,                         -- soft delete, see 6.5
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (id, expense_date),                           -- composite PK required for partitioning by expense_date
  CONSTRAINT chk_amount_nonzero CHECK (amount_minor_units <> 0),
  CONSTRAINT chk_adjustment_requires_reason
    CHECK (parent_expense_id IS NULL OR adjustment_reason IS NOT NULL),
  CONSTRAINT uq_org_expense_number UNIQUE (organization_id, expense_number)
) PARTITION BY RANGE (expense_date);

-- yearly partitions, created ahead via migration/cron:
CREATE TABLE expenses_2026 PARTITION OF expenses
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE expenses_2027 PARTITION OF expenses
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
```

**Indexes** (created per-partition automatically when defined on the parent in PG 15+):

```sql
CREATE INDEX idx_expenses_org_dept_status
  ON expenses (organization_id, department_id, status);

CREATE INDEX idx_expenses_org_vendor
  ON expenses (organization_id, vendor_id)
  WHERE vendor_id IS NOT NULL;

CREATE INDEX idx_expenses_org_project
  ON expenses (organization_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX idx_expenses_period
  ON expenses (period_id);

CREATE INDEX idx_expenses_parent
  ON expenses (parent_expense_id)
  WHERE parent_expense_id IS NOT NULL;
```

**Why range-partition by `expense_date` rather than `organization_id` (list partitioning) or leaving it unpartitioned:** you explicitly called out "millions of expenses" and "years of history" as a performance requirement, and the overwhelmingly dominant query pattern in this domain is date-bounded (monthly/quarterly/yearly reports, custom date ranges). Range partitioning on date means a query for "Q3 2026 expenses" only ever touches the `expenses_2026` partition — the planner prunes the rest automatically. Partitioning by `organization_id` would only pay off once true multi-tenancy with many orgs exists; today, with one tenant, it buys nothing. Partition strategy can be revisited (even combined, sub-partitioned) later without changing the logical schema — that's a DBA-level operation, not an application rewrite.

**Note the composite primary key `(id, expense_date)`** — Postgres requires the partition key to be part of any unique constraint on a partitioned table, so `id` alone can't be the sole PK here. Foreign keys *referencing* `expenses.id` from other tables therefore also need to be aware of this (see `attachments` below) — a real, non-obvious constraint worth calling out now so it doesn't surprise you at migration time.

#### `payroll_runs` and `payslips`

```sql
CREATE TABLE payroll_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  period_id       UUID NOT NULL REFERENCES financial_periods(id),
  status          payroll_run_status NOT NULL DEFAULT 'draft',
  run_month       DATE NOT NULL,               -- first-of-month marker
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_org_run_month UNIQUE (organization_id, run_month)
);

CREATE TABLE payslips (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id            UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  employee_id               UUID NOT NULL REFERENCES employees(id),
  salary_structure_snapshot JSONB NOT NULL,     -- frozen at generation time, immutable
  gross_pay_minor_units     BIGINT NOT NULL,
  net_pay_minor_units       BIGINT NOT NULL,
  currency                  CHAR(3) NOT NULL DEFAULT 'NGN',
  tax_computation            JSONB NOT NULL DEFAULT '{"strategy":"noop"}',
  encrypted_detail_blob      BYTEA,              -- AES-256-GCM envelope-encrypted line items
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_run_employee UNIQUE (payroll_run_id, employee_id),
  CONSTRAINT chk_net_lte_gross CHECK (net_pay_minor_units <= gross_pay_minor_units)
);
```

`salary_structure_snapshot` as JSONB (not a foreign key to a mutable `salary_structures` row) is the deliberate implementation of the Phase 2 invariant: a payslip must never change meaning if next month's salary structure changes. The encrypted blob holds the actual sensitive line-item breakdown; `gross_pay`/`net_pay` are kept in plaintext columns because reporting and reconciliation need to aggregate on them without decrypting every row — a concrete example of encrypting *only* what needs protecting rather than the whole record, to keep reporting queries viable.

#### Audit, Outbox, and Inbox — the trust infrastructure

```sql
CREATE TABLE outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type VARCHAR(64) NOT NULL,     -- 'Expense' | 'PayrollRun' | 'FinancialPeriod'
  aggregate_id   UUID NOT NULL,
  event_type     VARCHAR(128) NOT NULL,    -- 'ExpenseApproved', etc.
  payload        JSONB NOT NULL,
  status         outbox_status NOT NULL DEFAULT 'pending',  -- pending|dispatched|failed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at  TIMESTAMPTZ
);

CREATE INDEX idx_outbox_pending
  ON outbox_events (status, created_at)
  WHERE status = 'pending';

CREATE TABLE audit_log_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL,
  entity_type      VARCHAR(64) NOT NULL,
  entity_id        UUID NOT NULL,
  action           VARCHAR(64) NOT NULL,
  actor_user_id    UUID,
  old_value        JSONB,
  new_value        JSONB,
  reason           TEXT,
  correlation_id   UUID NOT NULL,
  request_id       UUID,
  ip_address       INET,
  user_agent       TEXT,
  source           VARCHAR(32) NOT NULL,   -- api|import_job|integration|background_worker
  prev_hash        CHAR(64) NOT NULL,      -- hash chain, reused from BED-6D
  entry_hash       CHAR(64) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity
  ON audit_log_entries (entity_type, entity_id);

CREATE INDEX idx_audit_correlation
  ON audit_log_entries (correlation_id);

-- append-only enforcement:
REVOKE UPDATE, DELETE ON audit_log_entries FROM application_role;
```

That last line matters as much as the hash chain itself: **the application's DB role is granted INSERT/SELECT only on this table, never UPDATE/DELETE.** A hash chain that the same role can also rewrite isn't tamper-evident against a compromised application layer — restricting it at the grant level is a real, cheap control, not just documentation of intent.

```sql
CREATE TABLE inbox_records (
  import_job_id      UUID NOT NULL REFERENCES import_jobs(id),
  source_record_hash CHAR(64) NOT NULL,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (import_job_id, source_record_hash)
);
```

The PK itself *is* the idempotency guarantee here — a duplicate import attempt hits a PK violation, which the ACL mapper (Phase 3.3) catches and treats as "already processed," not an error.

### 6.3 Enums Used

```sql
CREATE TYPE expense_status AS ENUM
  ('draft','pending_approval','approved','rejected','cancelled','closed');

CREATE TYPE expense_source_type AS ENUM
  ('manual','employee','accountant','import','integration');

CREATE TYPE payroll_run_status AS ENUM
  ('draft','pending_approval','approved','processing','completed','cancelled');

CREATE TYPE period_status AS ENUM
  ('open','closing','closed','reopened');

CREATE TYPE outbox_status AS ENUM
  ('pending','dispatched','failed');
```

Native Postgres enums over free-text/JSONB here because these are closed, domain-controlled vocabularies where invalid values should be structurally impossible — JSONB is reserved for genuinely open-ended or evolving shapes (`salary_structure_snapshot`, `tax_computation`), where forcing a rigid schema would fight the "pluggable tax engine later" requirement from Phase 2.

### 6.4 Soft Delete Strategy

Only `deleted_at` (nullable timestamp) on tables where a business user can hide a record from normal views — `expenses` (draft-stage records only, per domain rule), `vendors`, `projects`, `departments`. **Never** on `payslips`, `audit_log_entries`, `outbox_events`, or any approved/closed financial record — those are governed by the adjustment-only model (Phase 1/2), not deletion at all.

This distinction — soft-delete for "not yet financially real" records vs. adjustment-only for "financially real" records — is worth keeping explicit in code review going forward, since conflating them is exactly the kind of ambiguity that produces silent data-integrity bugs.

### 6.5 Migration & Versioning Strategy

* Prisma Migrate, one migration per logical schema change, committed alongside the code change that needs it — never hand-edited after being applied to any shared environment.
* Partition creation (new yearly `expenses_20XX` partition) handled by a scheduled maintenance migration/job run ahead of year-end, not reactively.
* Archiving: partitions older than a configurable retention window (tied to the Phase 1 statutory retention requirement) get detached and moved to cheaper storage rather than deleted — `ALTER TABLE expenses DETACH PARTITION expenses_2019` — preserving queryability if reattached, while keeping the hot table lean.

## Phase 7: API Design

### 7.1 Pagination Strategy — Cursor, Not Offset

Given "millions of expenses" and "years of history," offset pagination (`?page=500&limit=20`) degrades badly — Postgres still has to scan and discard the first 10,000 rows for page 500.

Cursor-based pagination instead:

```http
GET /api/v1/expenses?limit=25&cursor=eyJpZCI6Ii4uLiIsImNyZWF0ZWRBdCI6Ii4uLiJ9
```

The cursor encodes `(created_at, id)` — a stable, indexed tuple — base64'd, opaque to the client.

Response shape:

```json
{
  "data": [ /* expense records */ ],
  "pageInfo": {
    "nextCursor": "eyJ...",
    "hasNextPage": true
  }
}
```

Offset pagination is still offered for the *reporting* read-model endpoints specifically (`GET /reports/expenses/summary`), because those are already bounded/aggregated and users genuinely want "page 3 of this specific report" semantics — the choice is per-endpoint based on data shape, not a blanket rule.

### 7.2 Filtering, Sorting, Searching

Structured query parameters, not a raw filter DSL — keeps the API self-documenting in OpenAPI and maps directly onto the Specification pattern (Phase 5.4):

```http
GET /api/v1/expenses
  ?departmentId=...
  &vendorId=...
  &status=approved,pending_approval      // comma-separated = OR within field
  &dateFrom=2026-01-01&dateTo=2026-03-31
  &search=aws                             // full-text against description/expense_number
  &sort=-expenseDate,amount               // - prefix = descending
```

Each accepted filter/sort field maps to exactly one composed `Specification`, so the query handler never string-builds SQL from arbitrary client input — an unrecognized field is a 400, not silently ignored or passed through.

### 7.3 Bulk Operations

Bulk approve/reject (common for accountants processing a batch) as a distinct endpoint, not a loop of individual calls from the client:

```http
POST /api/v1/expenses/bulk-approve
```

```json
{
  "expenseIds": ["...", "...", "..."],
  "idempotencyKey": "..."
}
```

Response reports **per-item** outcome, not all-or-nothing — a batch of 50 where 48 succeed and 2 fail (e.g., one hits a closed period) should say so explicitly rather than rolling back all 48 or silently dropping the 2:

```json
{
  "succeeded": ["id1", "id2", "..."],
  "failed": [
    {
      "id": "id7",
      "error": {
        "type": "https://api.ratel-plus.com/errors/period-closed",
        "detail": "..."
      }
    }
  ]
}
```

This partial-success pattern matters specifically because an all-or-nothing bulk transaction across 50 independent aggregates would hold a transaction open far too long and turn one bad record into 49 legitimate approvals blocked — a real operational risk at the volumes this system targets.

### 7.4 Import / Export Endpoints

```http
POST /api/v1/imports                  → creates an ImportJob, returns 202 Accepted + jobId
GET  /api/v1/imports/{jobId}          → job status: pending|processing|completed|failed
GET  /api/v1/imports/{jobId}/errors   → per-record failures, keyed by source_record_hash
POST /api/v1/exports/expenses         → async export request (large exports run as background job, not sync)
GET  /api/v1/exports/{exportId}       → status + signed download URL when ready
```

Imports are asynchronous by design (`202`, not `200`) — reinforces the Inbox/idempotency architecture from Phase 3.4 rather than fighting it with a synchronous "upload and wait" endpoint that times out on a 10,000-row CSV.

### 7.5 Idempotency

Every mutating endpoint (`POST`, `PATCH`) accepts an `Idempotency-Key` header.

Server behavior: the first request with a given key executes and caches the response (keyed in Redis, TTL ~24h); a repeated request with the same key returns the cached response without re-executing.

This is separate from bulk-operation-level idempotency (7.3) and import-level idempotency (3.4) — three related but distinct mechanisms, each solving idempotency at the layer it actually occurs (single request retry, batch operation, async import replay).

### 7.6 Error Handling — RFC 7807 Problem Details

Every error response follows the same shape, generated by the single exception filter mentioned in Phase 5.7:

```json
{
  "type": "https://api.ratel-plus.com/errors/period-closed",
  "title": "Financial period is closed",
  "status": 409,
  "detail": "Period 2026-Q1 is closed. Submit an adjustment instead of editing this expense directly.",
  "instance": "/api/v1/expenses/a1b2c3",
  "correlationId": "..."
}
```

`type` URLs map 1:1 to the domain error classes defined in Phase 5.7 (`PeriodClosedError` → `.../period-closed`), so client-side error handling can branch on `type` reliably rather than parsing `detail` strings — `detail` is for humans, `type` is for code.

### 7.7 Authentication & Authorization on Every Route

```http
Authorization: Bearer <JWT>
```

Every controller method declares required permission(s) via decorator, checked by a guard that reads the Phase 9.1 permission matrix:

```typescript
@RequirePermission('expense:approve', { scope: 'department' })
@Post(':id/approve')
async approve(
  @Param('id') id: string,
  @CurrentUser() user: AuthUser,
) {
  // ...
}
```

The scope check (`department`) is resolved against the *specific resource* — the guard loads the target expense's `departmentId` and checks it against the user's department assignment, not just "does this role have this permission" in the abstract. This is what actually enforces least-privilege at the resource level rather than the role level alone.

### 7.8 OpenAPI / Swagger

Generated directly from NestJS decorators (`@ApiProperty`, `@ApiOperation`, `@ApiResponse`) rather than hand-maintained — DTOs already exist at the presentation layer (Phase 4.3) purely for this purpose, kept separate from domain models so the OpenAPI schema never accidentally leaks internal aggregate shape.

Served at `/api/docs` in non-production environments only; production exposes a static generated spec if needed for external integrator consumption, not a live introspectable Swagger UI.

### 7.9 Representative Endpoint Set (Expense Context)

```http
POST   /api/v1/expenses                    create draft
PATCH  /api/v1/expenses/:id                edit draft (rejected if period closed / not draft)
POST   /api/v1/expenses/:id/submit         → pending_approval
POST   /api/v1/expenses/:id/approve
POST   /api/v1/expenses/:id/reject
POST   /api/v1/expenses/:id/cancel
POST   /api/v1/expenses/:id/adjust         creates linked adjustment record
GET    /api/v1/expenses/:id
GET    /api/v1/expenses                    filtered/paginated list (7.2)
POST   /api/v1/expenses/bulk-approve
GET    /api/v1/expenses/:id/audit-trail    projected from audit_log_entries
```
# Phase 8: Integration Layer — Detailed Design

## 8.1 The Core Contracts (formalizing Phase 3.3)

```typescript
// integration/ports/provider-adapter.port.ts
export interface ProviderAdapter<TProviderPayload> {
  readonly providerId: string; // 'csv-upload', 'vos3000', 'ms-graph-invoices', ...
  fetch(job: ImportJobContext): Promise<TProviderPayload[]>;
}

// integration/ports/normalizer.port.ts
export interface Normalizer<TProviderPayload> {
  normalize(payload: TProviderPayload): RawImportRecord;
}

// integration/domain/raw-import-record.ts
export interface RawImportRecord {
  externalId: string;
  sourceRecordHash: string;      // deterministic hash, drives Inbox idempotency (3.4)
  amountMinorUnits: bigint;
  currency: string;
  vendorName?: string;
  description?: string;
  occurredAt: Date;
  rawPayload: Record<string, unknown>; // kept for audit/debugging, never fed directly to domain
}
```

Every provider — CSV, PDF invoice, email parser, VOS3000, bank statement, future Microsoft Graph/Google Workspace connectors — implements exactly these two interfaces and nothing more.

The ACL mapper downstream (3.3) only ever consumes `RawImportRecord`; it has zero knowledge of where the record came from.

This is what actually delivers "provider isolation" as more than a slogan: adding a new provider means writing one adapter + one normalizer, touching nothing else in the system.

## 8.2 Per-Provider Notes (where they genuinely differ)

| Provider                                    | Trigger model                                                 | Key challenge                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV/Excel upload                            | Synchronous trigger, async processing                         | Header mapping is user-configurable (columns vary per upload) — normalizer takes a `ColumnMapping` config resolved at upload time, not hardcoded                                 |
| PDF invoice upload                          | Synchronous trigger, async (OCR/parse) processing             | Needs a confidence score; below-threshold extractions land in a `needs_review` queue rather than auto-creating an expense — never trust OCR output blindly for financial figures |
| Email invoice parsing                       | Polling (IMAP) or provider webhook (e.g., Graph subscription) | Needs sender/domain allowlisting per vendor to avoid ingesting spoofed invoices — this is a real fraud vector, worth flagging explicitly                                         |
| VOS3000 API                                 | Scheduled polling                                             | Rate limits specific to that API — adapter owns its own backoff config, not a shared global one                                                                                  |
| Bank statement import                       | Scheduled polling or manual upload                            | Needs a reconciliation match step against existing expenses (fuzzy match on amount+date+vendor) rather than blind creation — flagged as "unmatched" for manual review otherwise  |
| Cloud provider APIs (AWS/Azure/GCP billing) | Scheduled polling, webhook where available                    | Multi-currency almost always in play here (USD billing against an NGN-primary org) — exercises the currency/FX seam from Phase 1.3 for real, not hypothetically                  |

## 8.3 Reliability Patterns Per Your Explicit Requirements

### Retry with Backoff

```typescript
// exponential backoff, capped, jitter to avoid thundering herd against a provider
const retryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};
```

Applied at the `ProviderAdapter.fetch()` call site via a generic retry wrapper — not duplicated per adapter.

### Circuit Breaker Per Provider

If VOS3000 starts failing consistently, the breaker opens and subsequent scheduled polls short-circuit immediately (logged, not silently dropped) rather than repeatedly hammering a down provider and burning worker capacity.

Half-open probes occur after a cooldown window.

Implemented as a shared utility (`opossum` library or a small custom implementation) wrapping each adapter, configured per-provider since failure tolerance differs (a CSV upload failing is a user-facing error immediately; a scheduled poll failing can tolerate several silent retries before alerting).

### Dead Letter Queue

Any `RawImportRecord` that fails ACL mapping/validation after retries goes to a DLQ (a BullMQ queue backed by a `failed_import_records` table, not just logs) — visible via:

```http
GET /api/v1/imports/{jobId}/errors
```

(Phase 7.4), so a failed record is a queryable, actionable thing, not something that silently vanishes.

### Rate Limiting (outbound, respecting provider limits)

Token bucket per provider, configured with that provider's documented limits — this is the adapter being a good citizen of the external API, distinct from the *inbound* rate limiting in Phase 9.6 that protects Ratel-Plus's own API.

## 8.4 Polling vs. Webhook — Decision Per Provider, Not System-Wide

Webhooks are preferred wherever the provider supports them (lower latency, less wasted polling), but every webhook endpoint requires:

* Signature verification (HMAC, provider-specific) before the payload is trusted at all.
* Idempotent handling via the same Inbox mechanism as polled imports — a webhook can be delivered more than once, and it should hit the same `sourceRecordHash` dedup path.
* A polling **fallback/reconciliation** job regardless, running at lower frequency, to catch webhook delivery failures — never rely on webhooks as the sole source of truth for financial data ingestion, since a missed webhook with no fallback becomes a silent gap in expense history, which is a materially worse failure mode here than in most domains.

## 8.5 Adding a Future Connector — Concrete Checklist

Because "Future Connectors" was explicit in your requirements, worth stating what "naturally supports" actually means operationally:

1. Implement `ProviderAdapter<TPayload>` + `Normalizer<TPayload>` for the new source.
2. Register provider metadata in `integration_providers` table (rate limits, auth type, polling/webhook config).
3. No changes to: ACL mapper, Inbox logic, Expense/Payroll domain, command handlers, DB schema.
4. New provider automatically gets retry/circuit-breaker/DLQ/idempotency for free, since those wrap the adapter interface generically rather than being reimplemented per provider.

That's the concrete test of whether this layer was actually designed correctly: a new connector should be additive, touching one new folder under `integration/adapters/`, never requiring a change to `contexts/expense/` or `contexts/payroll/`.

# Phase 9: Security Architecture

## 9.1 RBAC & Permission Matrix

Role-based access control alone tends to get coarse fast in financial systems ("Accountant" ends up meaning six different things). I'd design this as **role → permission → resource-scope**, three dimensions, not two:

```typescript
// shared-kernel/auth/permission.ts
type Permission =
  | 'expense:create' | 'expense:approve' | 'expense:view' | 'expense:adjust'
  | 'payroll:create' | 'payroll:approve' | 'payroll:view_sensitive'
  | 'period:close' | 'period:reopen'
  | 'audit:view' | 'user:manage';

type Scope = 'own' | 'department' | 'organization';
```

A role is a named bundle of `(permission, scope)` pairs, not a hardcoded switch statement.

Example matrix:

| Role                | `expense:create` | `expense:approve`            | `payroll:view_sensitive` | `period:close` | `audit:view` |
| ------------------- | ---------------- | ---------------------------- | ------------------------ | -------------- | ------------ |
| Employee            | own              | —                            | —                        | —              | —            |
| Accountant          | organization     | department (below threshold) | —                        | —              | —            |
| Department Head     | —                | department                   | —                        | —              | —            |
| Finance Director    | organization     | organization                 | organization             | organization   | —            |
| Payroll Admin       | —                | —                            | organization             | —              | —            |
| Auditor (read-only) | —                | —                            | —                        | —              | organization |

This table isn't decorative — it's literally what the `ApprovalPolicy` from Phase 2.2 and Phase 5.6 reads at runtime to compute a required approval chain, and what a `PermissionGuard` checks before a controller method executes.

Store it as seed data in a `role_permissions` table, not as an enum switch in code, so granting a new permission combination is a data change, not a deploy.

**Separation of Duties — enforced structurally, not just by role assignment:** the single most important SoD rule in this domain is *a requester cannot approve their own expense, and an approver cannot be the same person at two consecutive steps in a chain.*

This has to be checked in the `WorkflowEngine` itself (Phase 2.2), not left to "well, they shouldn't have that role" — role misconfiguration is exactly the kind of gap that gets exploited or, more realistically here, accidentally triggered by an admin fixing something in a hurry.

## 9.2 Authentication & MFA Readiness

* **JWT-based, stateless**, short-lived access tokens (15 min) + refresh token rotation, refresh tokens stored hashed server-side so a leaked DB doesn't hand out live sessions.
* MFA: not built now, but the auth module should have an `mfaVerifiedAt` claim slot in the token payload from day one and a `requiresMfa(permission)` check point in the guard chain — so turning MFA on later for `payroll:view_sensitive` and `period:close` specifically (the two most sensitive actions) is a config change, not a redesign.
* Payroll-sensitive endpoints get a **step-up requirement** even now: re-authentication (password re-entry) within the last N minutes before viewing/exporting salary data, independent of whether MFA is enabled — cheap to build, meaningfully reduces exposure from an unattended, already-logged-in session.

## 9.3 Encryption

**In transit:** TLS 1.2+ enforced at the ingress/load balancer, HSTS headers, no plaintext fallback — standard, not much to design here beyond making sure it's actually configured rather than assumed.

**At rest — two tiers, deliberately different:**

| Tier                              | Mechanism                                                                           | Applies to                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Database-level                    | Postgres native encryption at rest (disk/volume level, via managed hosting or LUKS) | Everything, baseline                                                                                          |
| Field-level (application-managed) | AES-256-GCM envelope encryption — reused directly from BED-6D                       | `payslips.encrypted_detail_blob`, `salary_structures` compensation fields, bank account numbers if/when added |

Field-level envelope encryption matters specifically because disk-level encryption protects against physical theft or unauthorized storage access, but does nothing against a compromised application role running an ordinary `SELECT * FROM payslips`.

Field-level encryption means even a full read-access DB credential leak doesn't expose raw salary figures without also compromising the KMS-held data-encryption keys — same threat model BED-6D was built against, applied here to the more sensitive dataset in this system.

**Key management:** DEK (data encryption key) per organization, wrapped by a KMS-held master key (AWS KMS / GCP KMS / HashiCorp Vault — pick based on hosting decision in Phase 10, not decided yet). Never store the unwrapped master key in application config or environment variables.

## 9.4 Secrets Management

* No secrets in `.env` files committed anywhere, ever — `.env.example` only, real values injected via the deployment platform's secret store (Phase 10 will fix the specific platform).
* Prisma's `DATABASE_URL`, Redis credentials, JWT signing keys, KMS credentials — all sourced from the secret store at boot, validated via the Zod-based config schema from Phase 4.4 (fail fast if missing, don't start with a degraded/insecure default).
* Rotation: JWT signing keys and DB credentials should be rotatable without a full redeploy — supports this by reading from the secret store on a short-lived cache rather than baking into the process at build time.

## 9.5 Input Validation & Injection Protection

* **class-validator DTOs** at the NestJS controller boundary — the presentation layer's responsibility, per the layering in Phase 4.3, so invalid shapes never even reach the application layer.
* **SQL injection:** structurally close to non-issue given Prisma's parameterized queries throughout — the one place to actively guard is if `$queryRaw` is ever used (e.g., for a partition-aware analytical query); any raw SQL usage should go through a lint rule requiring an explicit `Prisma.sql` tagged template, never string concatenation, and ideally requires a second reviewer.
* **XSS:** primarily a concern if this API ever serves HTML directly (it shouldn't — it's a JSON API), but any user-supplied text fields (expense `description`, `adjustment_reason`) that later render in a frontend or exported report should be treated as untrusted at render time by whatever consumes the API, and the API itself should reject control characters/null bytes at validation.
* **CSRF:** largely moot for a stateless, bearer-token JSON API with no cookie-based session — worth stating explicitly in the security doc so it's not flagged as a gap by a future audit that doesn't know the auth model.

## 9.6 Rate Limiting & API Security

* Token-bucket rate limiting via Redis, scoped per-user for authenticated endpoints and per-IP for auth endpoints (login, refresh) specifically, since credential-stuffing targets those disproportionately.
* Stricter limits on export/reporting endpoints (`GET /reports/*`) than on individual-resource endpoints — bulk data exfiltration risk is different from single-record access risk, and rate limiting should reflect that rather than using one blanket policy.
* All mutating endpoints (`POST`/`PATCH`) require an `Idempotency-Key` header, checked against a short-lived Redis record — protects against double-submission (network retry double-creating an expense) independent of the Inbox pattern, which is specifically for the *import* path.

## 9.7 Secure File Uploads

Given receipts/invoices/payslips/contracts are explicit requirements:

* Uploads go to object storage (S3-compatible), never through the application server's local disk, via pre-signed URLs — the API issues a scoped, short-lived upload URL rather than proxying file bytes itself.
* Server-side: file-type validation by content-sniffing (not just trusting the extension or client-provided MIME type), size limits, and virus scanning (ClamAV or a hosted scanning service) run as a background job *before* an attachment is marked "available" — an uploaded-but-unscanned file should be in a `pending_scan` state, not immediately visible/downloadable.
* Attachment metadata (`uploaded_by`, `scan_status`, `content_hash`) stored in Postgres; only the scanned, clean file is retrievable through the API.

## 9.8 OWASP Top 10 — Coverage Summary

| Risk                           | Mitigation already designed                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Broken Access Control          | RBAC + scope model (9.1), SoD enforcement in workflow engine                                                                                           |
| Cryptographic Failures         | Tiered encryption (9.3), TLS everywhere                                                                                                                |
| Injection                      | Prisma parameterization, DTO validation (9.5)                                                                                                          |
| Insecure Design                | Hexagonal architecture keeps invariants centralized, not scattered (Phase 5)                                                                           |
| Security Misconfiguration      | Fail-fast config validation (Phase 4.4), no secrets in code (9.4)                                                                                      |
| Vulnerable/Outdated Components | Dependency scanning in CI (Phase 14 topic)                                                                                                             |
| Auth Failures                  | JWT rotation, step-up for sensitive actions (9.2)                                                                                                      |
| Data Integrity Failures        | Hash-chained audit log (6.2), outbox transactional consistency (Phase 5.2)                                                                             |
| Logging/Monitoring Failures    | Structured logging + audit trail already designed (Phase 6, Phase 11 upcoming)                                                                         |
| SSRF                           | Integration adapters (Phase 3.3) validate/allowlist outbound URLs for any provider that accepts user-supplied endpoints (e.g., custom webhook targets) |

