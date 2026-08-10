-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('unscanned', 'clean', 'infected');

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'unscanned',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_expense_id_idx" ON "attachments"("expense_id");
