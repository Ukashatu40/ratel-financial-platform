/*
  Warnings:

  - Added the required column `template_data` to the `notification_logs` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
-- Step 1: Add the column as nullable so PostgreSQL doesn't fail on existing rows
ALTER TABLE "notification_logs" ADD COLUMN "template_data" JSONB;

-- Step 2: Backfill all existing records with an empty JSON object (or valid default keys)
UPDATE "notification_logs" SET "template_data" = '{}' WHERE "template_data" IS NULL;

-- Step 3: Enforce the NOT NULL constraint now that every row has data
ALTER TABLE "notification_logs" ALTER COLUMN "template_data" SET NOT NULL;
