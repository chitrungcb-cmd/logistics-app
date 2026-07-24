-- Người đứng ra chi mỗi khoản ShipmentCost ("do ai chi"), SetNull khi user bị xóa.
ALTER TABLE "ShipmentCost" ADD COLUMN "paidByUserId" TEXT;

ALTER TABLE "ShipmentCost"
  ADD CONSTRAINT "ShipmentCost_paidByUserId_fkey"
  FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ShipmentCost_paidByUserId_idx" ON "ShipmentCost"("paidByUserId");
