-- Distinguish configured estimates from costs confirmed by a user.
ALTER TABLE "ShipmentCost" ADD COLUMN "isActual" BOOLEAN NOT NULL DEFAULT true;
UPDATE "ShipmentCost" SET "isActual" = false WHERE "presetId" IS NOT NULL;

-- Idempotent notification sent after a declaration has had no actual costs for three days.
ALTER TYPE "NotificationType" ADD VALUE 'COST_MISSING';
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
