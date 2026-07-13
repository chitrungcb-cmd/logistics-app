-- CreateEnum
CREATE TYPE "CostAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "CostAuditLog" (
    "id" TEXT NOT NULL,
    "shipmentCostId" TEXT,
    "shipmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "CostAuditAction" NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CostAuditLog" ADD CONSTRAINT "CostAuditLog_shipmentCostId_fkey" FOREIGN KEY ("shipmentCostId") REFERENCES "ShipmentCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAuditLog" ADD CONSTRAINT "CostAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
