-- Phân bổ báo giá nhập tay (có hóa đơn chưa VAT / không hóa đơn) trên từng lô hàng.
ALTER TABLE "Shipment"
  ADD COLUMN "quoteInvoiceAmount" DOUBLE PRECISION,
  ADD COLUMN "quoteNoInvoiceAmount" DOUBLE PRECISION;

-- Mô-đun "Tài khoản cá nhân": theo dõi phần báo giá không hóa đơn của từng lô hàng.
CREATE TABLE "PersonalAccountEntry" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentDate" TIMESTAMP(3),
    "receivingAccount" TEXT,
    "assignedUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalAccountEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonalAccountEntry_shipmentId_key" ON "PersonalAccountEntry"("shipmentId");
CREATE INDEX "PersonalAccountEntry_paymentDate_idx" ON "PersonalAccountEntry"("paymentDate");
CREATE INDEX "PersonalAccountEntry_assignedUserId_idx" ON "PersonalAccountEntry"("assignedUserId");

ALTER TABLE "PersonalAccountEntry"
  ADD CONSTRAINT "PersonalAccountEntry_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalAccountEntry"
  ADD CONSTRAINT "PersonalAccountEntry_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
