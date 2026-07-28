-- Bảng giá chi phí cố định: thêm đơn vị tính + tài khoản chi mặc định.
ALTER TABLE "CostPreset"
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "paidByUserId" TEXT,
  ADD COLUMN "paidFromCompanyAccountId" TEXT;

ALTER TABLE "CostPreset"
  ADD CONSTRAINT "CostPreset_paidByUserId_fkey"
  FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostPreset"
  ADD CONSTRAINT "CostPreset_paidFromCompanyAccountId_fkey"
  FOREIGN KEY ("paidFromCompanyAccountId") REFERENCES "CompanyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
