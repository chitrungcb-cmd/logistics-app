-- Tách phần có hóa đơn / không hóa đơn cho công nợ phải thu, và gắn mỗi thanh toán vào đúng phần.
CREATE TYPE "DebtPortion" AS ENUM ('INVOICE', 'NO_INVOICE');

ALTER TABLE "Debt"
  ADD COLUMN "invoiceAmount" DOUBLE PRECISION,
  ADD COLUMN "noInvoiceAmount" DOUBLE PRECISION;

ALTER TABLE "Payment"
  ADD COLUMN "portion" "DebtPortion";
