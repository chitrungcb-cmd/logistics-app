ALTER TABLE "VendorInvoice" ADD COLUMN "shipmentId" TEXT;

CREATE INDEX "VendorInvoice_shipmentId_idx" ON "VendorInvoice"("shipmentId");

ALTER TABLE "VendorInvoice"
ADD CONSTRAINT "VendorInvoice_shipmentId_fkey"
FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
