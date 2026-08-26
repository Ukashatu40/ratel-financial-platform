-- CreateEnum
CREATE TYPE "EventDeliveryStatus" AS ENUM ('pending_retry', 'recovered', 'permanently_failed');

-- CreateTable
CREATE TABLE "failed_event_deliveries" (
    "id" TEXT NOT NULL,
    "outbox_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "subscriber_name" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT NOT NULL,
    "status" "EventDeliveryStatus" NOT NULL DEFAULT 'pending_retry',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failed_event_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "failed_event_deliveries_status_created_at_idx" ON "failed_event_deliveries"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "failed_event_deliveries_outbox_event_id_subscriber_name_key" ON "failed_event_deliveries"("outbox_event_id", "subscriber_name");
