-- CreateIndex
CREATE INDEX "audit_log_entries_organization_id_created_at_idx" ON "audit_log_entries"("organization_id", "created_at");
