/*
  Warnings:

  - A unique constraint covering the columns `[organization_id,name]` on the table `projects` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `departments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `expense_categories` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `vendors` table without a default value. This is not possible if the table is not empty.

*/

-- 1. Add fields (with updated_at as NULL temporarily)
ALTER TABLE "departments" 
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "expense_categories" 
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "projects" 
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);

ALTER TABLE "vendors" 
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "updated_at" TIMESTAMP(3);


-- 2. Backfill existing records with today's date/time
UPDATE "departments" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
UPDATE "expense_categories" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
UPDATE "projects" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;
UPDATE "vendors" SET "updated_at" = CURRENT_TIMESTAMP WHERE "updated_at" IS NULL;


-- 3. Enforce NOT NULL constraint now that rows are populated
ALTER TABLE "departments" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "expense_categories" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "vendors" ALTER COLUMN "updated_at" SET NOT NULL;


-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_name_key" ON "projects"("organization_id", "name");
