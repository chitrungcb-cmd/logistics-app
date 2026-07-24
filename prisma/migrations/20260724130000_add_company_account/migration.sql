-- Tài khoản công ty + liên kết "Chi từ TK" trên chi phí (bổ sung, không phá dữ liệu cũ).
CREATE TABLE "CompanyAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyAccount_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ShipmentCost" ADD COLUMN "paidFromCompanyAccountId" TEXT;

ALTER TABLE "ShipmentCost"
  ADD CONSTRAINT "ShipmentCost_paidFromCompanyAccountId_fkey"
  FOREIGN KEY ("paidFromCompanyAccountId") REFERENCES "CompanyAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ShipmentCost_paidFromCompanyAccountId_idx" ON "ShipmentCost"("paidFromCompanyAccountId");
