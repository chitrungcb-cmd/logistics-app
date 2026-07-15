CREATE TYPE "InvoiceReconciliationStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'NEEDS_REVIEW');

CREATE TABLE "VendorInvoice" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "emailSubject" TEXT,
    "emailFrom" TEXT,
    "vendorId" TEXT,
    "shipmentCostId" TEXT,
    "sellerName" TEXT,
    "sellerTaxCode" TEXT,
    "buyerName" TEXT,
    "buyerTaxCode" TEXT,
    "isIssuedToNq" BOOLEAN,
    "invoiceNumber" TEXT,
    "invoiceSymbol" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "subtotal" DOUBLE PRECISION,
    "taxAmount" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "attachmentName" TEXT NOT NULL,
    "attachmentUrl" TEXT NOT NULL,
    "xmlUrl" TEXT,
    "pdfUrl" TEXT,
    "status" "InvoiceReconciliationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorInvoice_sourceKey_key" ON "VendorInvoice"("sourceKey");
CREATE INDEX "VendorInvoice_gmailMessageId_idx" ON "VendorInvoice"("gmailMessageId");
CREATE INDEX "VendorInvoice_vendorId_idx" ON "VendorInvoice"("vendorId");
CREATE INDEX "VendorInvoice_shipmentCostId_idx" ON "VendorInvoice"("shipmentCostId");
CREATE INDEX "VendorInvoice_status_idx" ON "VendorInvoice"("status");
CREATE INDEX "VendorInvoice_invoiceDate_idx" ON "VendorInvoice"("invoiceDate");
CREATE INDEX "VendorInvoice_sellerTaxCode_idx" ON "VendorInvoice"("sellerTaxCode");
CREATE INDEX "VendorInvoice_invoiceNumber_idx" ON "VendorInvoice"("invoiceNumber");

ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VendorInvoice" ADD CONSTRAINT "VendorInvoice_shipmentCostId_fkey" FOREIGN KEY ("shipmentCostId") REFERENCES "ShipmentCost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
