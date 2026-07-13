-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('HAI_QUAN', 'BIEN_PHONG', 'KIEM_DICH', 'HA_TANG', 'BEN_BAI', 'SANG_TAI', 'VAN_TAI', 'HOA_HONG', 'KHAC');

-- CreateTable
CREATE TABLE "ShipmentCost" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isAdditional" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "quoteAmount" DOUBLE PRECISION NOT NULL,
    "quoteDate" TIMESTAMP(3),
    "attachmentUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ShipmentCost" ADD CONSTRAINT "ShipmentCost_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
