-- Preserve the actual VAT amount read from output invoices instead of assuming every invoice is 8%.
ALTER TABLE "Shipment" ADD COLUMN "quoteInvoiceTaxAmount" DOUBLE PRECISION;

-- Keep the accounting split alongside the gross receivable used for payment reconciliation.
ALTER TABLE "Debt" ADD COLUMN "invoiceSubtotal" DOUBLE PRECISION;
ALTER TABLE "Debt" ADD COLUMN "invoiceTaxAmount" DOUBLE PRECISION;
