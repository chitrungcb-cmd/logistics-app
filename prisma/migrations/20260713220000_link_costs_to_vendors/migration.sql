-- Link confirmed shipment costs and reusable cost presets to the existing vendor directory.
ALTER TABLE "ShipmentCost" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "CostPreset" ADD COLUMN "vendorId" TEXT;

CREATE INDEX "ShipmentCost_vendorId_idx" ON "ShipmentCost"("vendorId");
CREATE INDEX "CostPreset_vendorId_idx" ON "CostPreset"("vendorId");

ALTER TABLE "ShipmentCost"
ADD CONSTRAINT "ShipmentCost_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CostPreset"
ADD CONSTRAINT "CostPreset_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
