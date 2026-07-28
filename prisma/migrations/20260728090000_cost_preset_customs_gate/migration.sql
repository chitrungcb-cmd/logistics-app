-- Chi phí cố định theo cửa khẩu + nhãn hạng mục tùy chỉnh.
ALTER TABLE "CostPreset"
  ADD COLUMN "customsGate" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "customLabel" TEXT;

-- Đổi ràng buộc duy nhất: cho phép cùng nhóm hàng + hạng mục nhưng khác cửa khẩu.
DROP INDEX IF EXISTS "CostPreset_goodsKeyword_category_key";
CREATE UNIQUE INDEX "CostPreset_goodsKeyword_customsGate_category_key"
  ON "CostPreset"("goodsKeyword", "customsGate", "category");
