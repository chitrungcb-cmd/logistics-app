-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "transportRoute" TEXT,
ADD COLUMN "vehiclePlate" TEXT;

-- Expand quote lines from four fixed categories to an editable itemized quotation.
DROP INDEX IF EXISTS "ShipmentQuoteLine_shipmentId_category_key";
ALTER TABLE "ShipmentQuoteLine"
ALTER COLUMN "category" DROP NOT NULL,
ADD COLUMN "description" TEXT,
ADD COLUMN "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "unit" TEXT,
ADD COLUMN "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "hasInvoice" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ShipmentQuoteLine"
SET "description" = CASE "category"::text
  WHEN 'THU_TUC_HAI_QUAN' THEN 'Thủ tục hải quan'
  WHEN 'VAN_TAI' THEN 'Vận tải'
  WHEN 'DANG_KIEM' THEN 'Đăng kiểm'
  WHEN 'PHAT_SINH' THEN 'Chi phí phát sinh'
  ELSE 'Hạng mục báo giá'
END,
"unitPrice" = "amount";
ALTER TABLE "ShipmentQuoteLine" ALTER COLUMN "description" SET NOT NULL;

-- CreateTable
CREATE TABLE "TaskStatusLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "fromStatus" "TaskStatus" NOT NULL,
    "toStatus" "TaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskStatusLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TaskStatusLog" ADD CONSTRAINT "TaskStatusLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskStatusLog" ADD CONSTRAINT "TaskStatusLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
