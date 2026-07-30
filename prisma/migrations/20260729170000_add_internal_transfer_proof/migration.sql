-- Lưu ảnh/chứng từ chuyển tiền cho từng lần tạm ứng hoặc hoàn ứng.
ALTER TABLE "InternalTransfer"
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentUrl" TEXT;
