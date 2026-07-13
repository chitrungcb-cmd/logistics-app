-- DropForeignKey
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_orderId_fkey";
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_warehouseId_fkey";
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_carrierId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Shipment";
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "Warehouse";
DROP TABLE IF EXISTS "Carrier";

-- DropEnum
DROP TYPE IF EXISTS "ShipmentStatus";

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentCode" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "taxCode" TEXT,
    "declarationNo" TEXT,
    "declarationDate" TIMESTAMP(3),
    "invoiceNo" TEXT,
    "customsType" TEXT,
    "port" TEXT,
    "goodsName" TEXT,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Đang làm thủ tục',
    "customsOffice" TEXT,
    "transport" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attachments" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentCode_key" ON "Shipment"("shipmentCode");
