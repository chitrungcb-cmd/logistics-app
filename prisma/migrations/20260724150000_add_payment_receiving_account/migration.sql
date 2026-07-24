-- "TK nhận tiền" cho mỗi Payment: thu vào TK công ty hoặc TK cá nhân của một người (loại trừ nhau).
ALTER TABLE "Payment" ADD COLUMN "receivedToCompanyAccountId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "receivedByUserId" TEXT;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_receivedToCompanyAccountId_fkey"
  FOREIGN KEY ("receivedToCompanyAccountId") REFERENCES "CompanyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_receivedByUserId_fkey"
  FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payment_receivedToCompanyAccountId_idx" ON "Payment"("receivedToCompanyAccountId");
CREATE INDEX "Payment_receivedByUserId_idx" ON "Payment"("receivedByUserId");
