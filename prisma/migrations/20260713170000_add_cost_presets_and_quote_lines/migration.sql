-- CreateEnum
CREATE TYPE "QuoteLineCategory" AS ENUM ('THU_TUC_HAI_QUAN', 'VAN_TAI', 'DANG_KIEM', 'PHAT_SINH');

-- AlterTable
ALTER TABLE "ShipmentCost" ADD COLUMN "presetId" TEXT;

-- CreateTable
CREATE TABLE "CostPreset" (
    "id" TEXT NOT NULL,
    "goodsName" TEXT NOT NULL,
    "goodsKeyword" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentQuoteLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "category" "QuoteLineCategory" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShipmentQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostPreset_goodsKeyword_category_key" ON "CostPreset"("goodsKeyword", "category");
CREATE UNIQUE INDEX "ShipmentCost_shipmentId_presetId_key" ON "ShipmentCost"("shipmentId", "presetId");
CREATE UNIQUE INDEX "ShipmentQuoteLine_shipmentId_category_key" ON "ShipmentQuoteLine"("shipmentId", "category");

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "CostPreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentQuoteLine" ADD CONSTRAINT "ShipmentQuoteLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
