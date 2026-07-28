-- Giá chi phí cố định theo mốc thời gian "áp dụng từ ngày".
ALTER TABLE "CostPreset"
  ADD COLUMN "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00';

-- Đổi ràng buộc duy nhất: cho phép nhiều mốc giá cho cùng nhóm hàng + cửa khẩu + hạng mục.
DROP INDEX IF EXISTS "CostPreset_goodsKeyword_customsGate_category_key";
CREATE UNIQUE INDEX "CostPreset_goodsKeyword_customsGate_category_effectiveFrom_key"
  ON "CostPreset"("goodsKeyword", "customsGate", "category", "effectiveFrom");
