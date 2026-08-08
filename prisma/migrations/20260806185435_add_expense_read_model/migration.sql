-- CreateTable
CREATE TABLE "expense_read_model" (
    "expenseId" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "department_name" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "category_name" TEXT NOT NULL,
    "vendor_id" TEXT,
    "vendor_name" TEXT,
    "project_id" TEXT,
    "amount_minor_units" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "parent_expense_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_read_model_pkey" PRIMARY KEY ("expenseId")
);

-- CreateIndex
CREATE INDEX "expense_read_model_organization_id_department_id_status_exp_idx" ON "expense_read_model"("organization_id", "department_id", "status", "expense_date");

-- CreateIndex
CREATE INDEX "expense_read_model_organization_id_category_id_status_expen_idx" ON "expense_read_model"("organization_id", "category_id", "status", "expense_date");

-- CreateIndex
CREATE INDEX "expense_read_model_organization_id_vendor_id_status_expense_idx" ON "expense_read_model"("organization_id", "vendor_id", "status", "expense_date");
