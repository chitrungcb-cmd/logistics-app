-- CreateEnum
CREATE TYPE "OtherExpenseCategory" AS ENUM (
  'TIEP_KHACH',
  'AN_UONG',
  'VAN_PHONG_PHAM',
  'DI_LAI',
  'DIEN_NUOC_INTERNET',
  'THUE_VAN_PHONG',
  'SUA_CHUA_BAO_TRI',
  'PHI_NGAN_HANG',
  'KHAC'
);

-- CreateTable
CREATE TABLE "OtherExpense" (
  "id" TEXT NOT NULL,
  "category" "OtherExpenseCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "payee" TEXT,
  "paymentMethod" TEXT,
  "invoiceNumber" TEXT,
  "attachmentName" TEXT,
  "attachmentUrl" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OtherExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtherExpense_expenseDate_idx" ON "OtherExpense"("expenseDate");
CREATE INDEX "OtherExpense_category_idx" ON "OtherExpense"("category");
CREATE INDEX "OtherExpense_createdById_idx" ON "OtherExpense"("createdById");

ALTER TABLE "OtherExpense"
  ADD CONSTRAINT "OtherExpense_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
