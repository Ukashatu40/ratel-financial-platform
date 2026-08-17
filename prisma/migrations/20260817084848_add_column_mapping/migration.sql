-- AlterTable
ALTER TABLE "import_jobs" ADD COLUMN     "resolved_mapping" JSONB;

-- CreateTable
CREATE TABLE "column_mappings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "column_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "column_mappings_organization_id_name_key" ON "column_mappings"("organization_id", "name");
