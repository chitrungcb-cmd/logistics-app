-- Thu/chi khác: thêm chiều THU/CHI cho OtherExpense. Mặc định CHI để dữ liệu cũ giữ nguyên là chi phí.
CREATE TYPE "OtherEntryType" AS ENUM ('THU', 'CHI');
ALTER TABLE "OtherExpense" ADD COLUMN "type" "OtherEntryType" NOT NULL DEFAULT 'CHI';
