ALTER TABLE "Debt" ADD COLUMN "sourceKey" TEXT;

CREATE UNIQUE INDEX "Debt_sourceKey_key" ON "Debt"("sourceKey");
