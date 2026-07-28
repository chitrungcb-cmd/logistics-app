import { prisma } from "@/lib/prisma";
import { determineInvoiceDirection } from "@/lib/vendor-invoice-parser";
import {
  loadOutputShipmentCandidates,
  matchOutputInvoiceToShipment,
} from "@/lib/vendor-invoice-reconciliation";

const invoiceSelect = {
  id: true,
  sellerName: true,
  sellerTaxCode: true,
  buyerName: true,
  buyerTaxCode: true,
  invoiceNumber: true,
  invoiceSymbol: true,
  invoiceDate: true,
  subtotal: true,
  taxAmount: true,
  totalAmount: true,
  currency: true,
  attachmentName: true,
  attachmentUrl: true,
  xmlUrl: true,
  pdfUrl: true,
  status: true,
} as const;

/** Trả về toàn bộ công nợ và hóa đơn đã xác định thuộc một lô hàng. */
export async function getShipmentFinanceLinks(shipmentId: string) {
  const [shipment, debts, explicitlyLinkedInvoices, inputInvoices, outputInvoices, outputCandidates] = await Promise.all([
    prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } }),
    prisma.debt.findMany({
      where: { shipmentId },
      select: { id: true, type: true, totalAmount: true, status: true, dueDate: true, sourceKey: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.vendorInvoice.findMany({
      where: { shipmentId },
      select: invoiceSelect,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.vendorInvoice.findMany({
      where: { shipmentCost: { shipmentId } },
      select: invoiceSelect,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.vendorInvoice.findMany({
      where: { buyerName: { not: null } },
      select: invoiceSelect,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      take: 1000,
    }),
    loadOutputShipmentCandidates(),
  ]);
  if (!shipment) return null;

  const linkedOutputInvoices = outputInvoices.filter((invoice) => {
    const direction = determineInvoiceDirection(
      invoice.sellerName,
      invoice.sellerTaxCode,
      invoice.buyerName,
      invoice.buyerTaxCode
    );
    if (direction !== "OUTPUT") return false;
    return matchOutputInvoiceToShipment(invoice, outputCandidates)?.id === shipmentId;
  });

  const seen = new Set<string>();
  const invoices = [...explicitlyLinkedInvoices, ...inputInvoices, ...linkedOutputInvoices]
    .filter((invoice) => {
      if (seen.has(invoice.id)) return false;
      seen.add(invoice.id);
      return true;
    })
    .map((invoice) => ({
      ...invoice,
      invoiceDirection: determineInvoiceDirection(
        invoice.sellerName,
        invoice.sellerTaxCode,
        invoice.buyerName,
        invoice.buyerTaxCode
      ),
    }));

  return { debts, invoices };
}
