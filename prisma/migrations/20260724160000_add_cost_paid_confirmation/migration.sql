-- Trạng thái "đã thanh toán" cho từng dòng chi phí (tích trong công nợ Phải trả).
ALTER TABLE "ShipmentCost"
  ADD COLUMN "isPaid" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paidConfirmedByUserId" TEXT;

ALTER TABLE "ShipmentCost"
  ADD CONSTRAINT "ShipmentCost_paidConfirmedByUserId_fkey"
  FOREIGN KEY ("paidConfirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ShipmentCost_paidConfirmedByUserId_idx" ON "ShipmentCost"("paidConfirmedByUserId");
