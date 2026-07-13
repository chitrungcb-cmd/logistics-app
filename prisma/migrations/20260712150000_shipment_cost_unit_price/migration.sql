-- AlterTable
ALTER TABLE "ShipmentCost" ADD COLUMN     "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "attachmentUrl" TEXT;
