-- Ghi nhận tạm ứng/hoàn ứng giữa các cá nhân mà không làm tăng tổng thu/chi của công ty.
CREATE TYPE "InternalTransferType" AS ENUM ('ADVANCE', 'RETURN');

CREATE TABLE "InternalTransfer" (
  "id" TEXT NOT NULL,
  "type" "InternalTransferType" NOT NULL DEFAULT 'ADVANCE',
  "transferDate" TIMESTAMP(3) NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InternalTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InternalTransfer_different_users_check" CHECK ("fromUserId" <> "toUserId"),
  CONSTRAINT "InternalTransfer_positive_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "InternalTransfer_transferDate_idx" ON "InternalTransfer"("transferDate");
CREATE INDEX "InternalTransfer_fromUserId_idx" ON "InternalTransfer"("fromUserId");
CREATE INDEX "InternalTransfer_toUserId_idx" ON "InternalTransfer"("toUserId");

ALTER TABLE "InternalTransfer"
  ADD CONSTRAINT "InternalTransfer_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InternalTransfer"
  ADD CONSTRAINT "InternalTransfer_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InternalTransfer"
  ADD CONSTRAINT "InternalTransfer_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
