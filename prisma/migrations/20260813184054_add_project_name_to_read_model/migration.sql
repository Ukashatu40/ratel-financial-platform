-- AlterTable
ALTER TABLE "expense_read_model" ADD COLUMN     "project_name" TEXT;

-- CreateIndex
CREATE INDEX "expense_read_model_organization_id_project_id_status_expens_idx" ON "expense_read_model"("organization_id", "project_id", "status", "expense_date");
