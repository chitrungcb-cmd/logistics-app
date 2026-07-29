-- Lưu từng xe của lô ô tô để tra cứu ngược bằng số khung hoặc số máy.
CREATE TABLE "ShipmentVehicle" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "chassisNo" TEXT,
  "engineNo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShipmentVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShipmentVehicle_chassisNo_key" ON "ShipmentVehicle"("chassisNo");
CREATE UNIQUE INDEX "ShipmentVehicle_engineNo_key" ON "ShipmentVehicle"("engineNo");
CREATE INDEX "ShipmentVehicle_shipmentId_idx" ON "ShipmentVehicle"("shipmentId");

ALTER TABLE "ShipmentVehicle"
  ADD CONSTRAINT "ShipmentVehicle_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
