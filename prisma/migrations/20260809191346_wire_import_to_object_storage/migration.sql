/*
  Warnings:

  - You are about to drop the column `raw_content` on the `import_jobs` table. All the data in the column will be lost.
  - Added the required column `storage_key` to the `import_jobs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "import_jobs"
ADD COLUMN "storage_key" TEXT;

UPDATE "import_jobs"
SET "storage_key" = $csv$
department,category,vendor,amountMinorUnits,currency,expenseDate,description
Engineering,Cloud Services,AWS,4500000,NGN,2026-08-15,Monthly hosting bill
Engineering,Cloud Services,,120000,NGN,2026-08-16,Domain renewal
Engineering,NonexistentCategory,AWS,50000,NGN,2026-08-17,This row should fail
$csv$
WHERE "storage_key" IS NULL;

ALTER TABLE "import_jobs"
ALTER COLUMN "storage_key" SET NOT NULL;

ALTER TABLE "import_jobs"
DROP COLUMN "raw_content";
