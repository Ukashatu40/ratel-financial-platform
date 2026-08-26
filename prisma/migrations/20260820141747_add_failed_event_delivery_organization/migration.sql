-- AlterTable
ALTER TABLE "failed_event_deliveries" ADD COLUMN     "organization_id" TEXT NOT NULL DEFAULT 'unknown';

-- CreateIndex
CREATE INDEX "failed_event_deliveries_organization_id_status_created_at_idx" ON "failed_event_deliveries"("organization_id", "status", "created_at");
