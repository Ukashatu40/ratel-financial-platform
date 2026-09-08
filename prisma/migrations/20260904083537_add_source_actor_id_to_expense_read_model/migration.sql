-- AlterTable
ALTER TABLE "expense_read_model" ADD COLUMN     "source_actor_id" TEXT NOT NULL DEFAULT 'unknown';

-- CreateIndex
CREATE INDEX "expense_read_model_organization_id_source_actor_id_status_e_idx" ON "expense_read_model"("organization_id", "source_actor_id", "status", "expense_date");
