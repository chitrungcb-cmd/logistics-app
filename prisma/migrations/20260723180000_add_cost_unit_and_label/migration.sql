-- Thêm đơn vị tính và tên hạng mục tùy chỉnh cho từng dòng chi phí (bổ sung, không phá dữ liệu cũ).
ALTER TABLE "ShipmentCost"
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "customLabel" TEXT;
