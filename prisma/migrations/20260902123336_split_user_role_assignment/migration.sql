/*
  Warnings:

  - You are about to drop the `user_role_assignments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_role_assignments" DROP CONSTRAINT "user_role_assignments_user_id_fkey";

-- DropTable
DROP TABLE "user_role_assignments";

-- CreateTable
CREATE TABLE "department_role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "department_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "RoleName" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "department_role_assignments_user_id_idx" ON "department_role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "department_role_assignments_organization_id_role_idx" ON "department_role_assignments"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "department_role_assignments_user_id_role_department_id_key" ON "department_role_assignments"("user_id", "role", "department_id");

-- CreateIndex
CREATE INDEX "organization_role_assignments_user_id_idx" ON "organization_role_assignments"("user_id");

-- CreateIndex
CREATE INDEX "organization_role_assignments_organization_id_role_idx" ON "organization_role_assignments"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_role_assignments_user_id_role_key" ON "organization_role_assignments"("user_id", "role");

-- AddForeignKey
ALTER TABLE "department_role_assignments" ADD CONSTRAINT "department_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_role_assignments" ADD CONSTRAINT "organization_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
