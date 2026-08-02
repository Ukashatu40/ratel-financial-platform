/*
  Warnings:

  - Added the required column `correlation_id` to the `outbox_events` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'background_worker',
ADD COLUMN     "user_agent" TEXT;

-- Backfill existing rows
UPDATE "outbox_events"
SET "correlation_id" = gen_random_uuid()::text
WHERE "correlation_id" IS NULL;

-- Make it required for future rows
ALTER TABLE "outbox_events"
ALTER COLUMN "correlation_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "request_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "source" TEXT NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_entries_entity_type_entity_id_idx" ON "audit_log_entries"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_entries_correlation_id_idx" ON "audit_log_entries"("correlation_id");
