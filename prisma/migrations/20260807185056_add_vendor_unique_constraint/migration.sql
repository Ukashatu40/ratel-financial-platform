/*
  Warnings:

  - A unique constraint covering the columns `[organization_id,name]` on the table `vendors` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "vendors_organization_id_name_key" ON "vendors"("organization_id", "name");
