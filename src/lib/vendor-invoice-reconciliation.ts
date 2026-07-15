import { prisma } from "@/lib/prisma";
import { normalizeInvoiceNumber, type ParsedVendorInvoice } from "@/lib/vendor-invoice-parser";

export type ReconciliationStatus = "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW";

function normalizeTaxCode(value: string | null | undefined) {
  return (value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Finds the vendor represented by the invoice, creating it only when the seller can be identified. */
export async function findOrCreateInvoiceVendor(parsed: ParsedVendorInvoice) {
  const sellerName = parsed.sellerName?.trim() || null;
  const sellerTaxCode = parsed.sellerTaxCode?.trim() || null;
  if (!sellerName && !sellerTaxCode) return null;

  let vendor = sellerTaxCode
    ? await prisma.vendor.findFirst({ where: { taxCode: sellerTaxCode } })
    : null;

  if (!vendor && sellerTaxCode) {
    // Some manually entered partner records contain spaces or dashes in the tax code. Compare the
    // normalized form before creating another partner for the same company.
    const taxCandidates = await prisma.vendor.findMany({
      where: { taxCode: { not: null } },
      orderBy: { updatedAt: "desc" },
    });
    vendor = taxCandidates.find((item) => normalizeTaxCode(item.taxCode) === normalizeTaxCode(sellerTaxCode)) ?? null;
  }

  if (!vendor && sellerName) {
    vendor = await prisma.vendor.findFirst({
      where: { name: { equals: sellerName, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (!vendor) {
    return prisma.vendor.create({
      data: {
        name: sellerName || `Nhà cung cấp MST ${sellerTaxCode}`,
        taxCode: sellerTaxCode,
        type: "Nhà cung cấp từ hóa đơn",
        note: "Tự động tạo từ hóa đơn nhận qua Gmail.",
      },
    });
  }

  const updates: { name?: string; taxCode?: string } = {};
  if (!vendor.taxCode && sellerTaxCode) updates.taxCode = sellerTaxCode;
  if ((!vendor.name || vendor.name.startsWith("Nhà cung cấp MST ")) && sellerName) updates.name = sellerName;
  if (Object.keys(updates).length > 0) {
    vendor = await prisma.vendor.update({ where: { id: vendor.id }, data: updates });
  }
  return vendor;
}

async function findMatchingShipmentCost(invoiceNumber: string, vendorId: string | null) {
  const normalizedInvoiceNumber = normalizeInvoiceNumber(invoiceNumber);
  if (!normalizedInvoiceNumber) return null;

  const candidates = await prisma.shipmentCost.findMany({
    where: { invoiceNumber: { not: null } },
    select: { id: true, vendorId: true, invoiceNumber: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const matches = candidates.filter(
    (candidate) => normalizeInvoiceNumber(candidate.invoiceNumber) === normalizedInvoiceNumber
  );
  if (matches.length === 0) return null;

  const sameVendor = vendorId ? matches.find((candidate) => candidate.vendorId === vendorId) : null;
  if (sameVendor) return sameVendor;

  // An invoice number can be reused by different sellers. Only take an unassigned row when it is
  // unique; otherwise an accountant must decide instead of the system guessing.
  const unassigned = matches.filter((candidate) => !candidate.vendorId);
  if (unassigned.length === 1) return unassigned[0];
  if (!vendorId && matches.length === 1) return matches[0];
  return null;
}

export async function reconcileParsedVendorInvoice(parsed: ParsedVendorInvoice) {
  // Do not pollute the partner directory with sellers from invoices addressed to another company.
  const vendor = parsed.isIssuedToNq === false ? null : await findOrCreateInvoiceVendor(parsed);

  if (parsed.isIssuedToNq === false || !parsed.invoiceNumber) {
    return {
      vendorId: vendor?.id ?? null,
      shipmentCostId: null,
      status: "NEEDS_REVIEW" as ReconciliationStatus,
    };
  }

  const cost = await findMatchingShipmentCost(parsed.invoiceNumber, vendor?.id ?? null);
  if (!cost) {
    return {
      vendorId: vendor?.id ?? null,
      shipmentCostId: null,
      status: "UNMATCHED" as ReconciliationStatus,
    };
  }

  if (vendor && !cost.vendorId) {
    await prisma.shipmentCost.update({ where: { id: cost.id }, data: { vendorId: vendor.id } });
  }
  return {
    vendorId: vendor?.id ?? cost.vendorId ?? null,
    shipmentCostId: cost.id,
    status: "MATCHED" as ReconciliationStatus,
  };
}

/** Re-runs matching after staff add an invoice number/vendor to a cost row. */
export async function reconcileStoredVendorInvoices() {
  const invoices = await prisma.vendorInvoice.findMany({ orderBy: { createdAt: "asc" } });
  const summary = { total: invoices.length, matched: 0, unmatched: 0, needsReview: 0 };

  for (const invoice of invoices) {
    const parsed: ParsedVendorInvoice = {
      sellerName: invoice.sellerName,
      sellerTaxCode: invoice.sellerTaxCode,
      buyerName: invoice.buyerName,
      buyerTaxCode: invoice.buyerTaxCode,
      invoiceNumber: invoice.invoiceNumber,
      invoiceSymbol: invoice.invoiceSymbol,
      invoiceDate: invoice.invoiceDate,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      isIssuedToNq: invoice.isIssuedToNq,
    };
    const result = await reconcileParsedVendorInvoice(parsed);
    await prisma.vendorInvoice.update({
      where: { id: invoice.id },
      data: {
        vendorId: result.vendorId,
        shipmentCostId: result.shipmentCostId,
        status: result.status,
      },
    });

    if (result.status === "MATCHED") summary.matched++;
    else if (result.status === "UNMATCHED") summary.unmatched++;
    else summary.needsReview++;
  }
  return summary;
}
