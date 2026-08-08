-- Thu chi khác: thêm tài khoản công ty nhận/chi tiền cho mỗi khoản (nullable, SetNull khi TK bị xóa).
ALTER TABLE "OtherExpense" ADD COLUMN "companyAccountId" TEXT;
ALTER TABLE "OtherExpense" ADD CONSTRAINT "OtherExpense_companyAccountId_fkey"
  FOREIGN KEY ("companyAccountId") REFERENCES "CompanyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "OtherExpense_companyAccountId_idx" ON "OtherExpense"("companyAccountId");
