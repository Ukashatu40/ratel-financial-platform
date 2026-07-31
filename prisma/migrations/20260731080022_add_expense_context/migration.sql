-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'closed');

-- CreateEnum
CREATE TYPE "ExpenseSourceType" AS ENUM ('manual', 'employee', 'accountant', 'import', 'integration');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_number_sequences" (
    "organization_id" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expense_number_sequences_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "expense_number" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'draft',
    "source_type" "ExpenseSourceType" NOT NULL,
    "source_actor_id" TEXT NOT NULL,
    "source_import_job_id" TEXT,
    "amount_minor_units" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "category_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "department_id" TEXT NOT NULL,
    "project_id" TEXT,
    "period_id" TEXT NOT NULL,
    "parent_expense_id" TEXT,
    "adjustment_reason" TEXT,
    "expense_date" DATE NOT NULL,
    "description" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id","expense_date")
);

-- CreateTable
CREATE TABLE "approval_progress" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "chain" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" TEXT NOT NULL,
    "progress_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "approver_id" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "reason" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_organization_id_name_key" ON "departments"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_name_key" ON "expense_categories"("organization_id", "name");

-- CreateIndex
CREATE INDEX "expenses_organization_id_department_id_status_idx" ON "expenses"("organization_id", "department_id", "status");

-- CreateIndex
CREATE INDEX "expenses_organization_id_vendor_id_idx" ON "expenses"("organization_id", "vendor_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_project_id_idx" ON "expenses"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "expenses_period_id_idx" ON "expenses"("period_id");

-- CreateIndex
CREATE INDEX "expenses_parent_expense_id_idx" ON "expenses"("parent_expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organization_id_expense_number_key" ON "expenses"("organization_id", "expense_number");

-- CreateIndex
CREATE UNIQUE INDEX "approval_progress_item_id_key" ON "approval_progress"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "approval_records_progress_id_step_order_key" ON "approval_records"("progress_id", "step_order");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_progress_id_fkey" FOREIGN KEY ("progress_id") REFERENCES "approval_progress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "chk_amount_nonzero" CHECK ("amount_minor_units" <> 0);

ALTER TABLE "expenses" ADD CONSTRAINT "chk_adjustment_requires_reason" CHECK ("parent_expense_id" IS NULL OR "adjustment_reason" IS NOT NULL);
