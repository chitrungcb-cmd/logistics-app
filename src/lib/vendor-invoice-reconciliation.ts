import { prisma } from "@/lib/prisma";
import {
  determineInvoiceDirection,
  normalizeInvoiceNumber,
  type ParsedVendorInvoice,
} from "@/lib/vendor-invoice-parser";
import { AUTOMATIC_RECEIVABLE_DEBT_PREFIX, syncShipmentDebts } from "@/lib/shipment-debt-sync";
import { sharesDeclarationFamily } from "@/lib/shipment-constants";
import { syncPersonalAccountEntry } from "@/lib/personal-account-sync";

export type ReconciliationStatus = "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW";

function normalizeTaxCode(value: string | null | undefined) {
  return (value || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function normalizeCompanyName(value: string | null | undefined) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

export type OutputInvoiceMatchSource = Pick<
  ParsedVendorInvoice,
  "buyerName" | "buyerTaxCode" | "subtotal" | "totalAmount"
>;

export type OutputShipmentCandidate = {
  id: string;
  shipmentCode: string;
  declarationNo: string | null;
  declarationBranches: unknown;
  declarationDate: Date | null;
  goodsName: string | null;
  customerName: string;
  taxCode: string | null;
  customer: { companyName: string; taxCode: string } | null;
  debts: Array<{
    id: string;
    sourceKey: string | null;
    totalAmount: number;
    status: string;
    dueDate: Date | null;
    type: string;
  }>;
  quotes: Array<{ quoteAmount: number }>;
};

function amountsEqual(left: number, right: number) {
  return Math.abs(left - right) < 1;
}

/**
 * Ghép hóa đơn bán ra với lô hàng bằng khách mua và khoản phải thu tự động. Số invoice trên tờ khai
 * không được dùng ở đây vì đó là commercial invoice của hồ sơ hải quan, không phải hóa đơn NQ xuất.
 */
/**
 * Khớp hóa đơn bán ra với lô theo SỐ TỜ KHAI ghi trong nội dung hóa đơn (HĐ xe ô tô: "theo tờ khai
 * nhập khẩu số ..."). Authoritative — số tờ khai định danh đúng một lô. Trả về lô khi có đúng một lô
 * cùng "họ tờ khai" (cùng 11 số đầu) với một trong các số trên hóa đơn; nhiều/không có thì trả null.
 */
export function matchOutputInvoiceByDeclaration(
  invoice: { declarationNumbers?: string[] },
  candidates: OutputShipmentCandidate[]
) {
  const numbers = invoice.declarationNumbers ?? [];
  if (numbers.length === 0) return null;
  const matches = candidates.filter((candidate) =>
    numbers.some((number) =>
      sharesDeclarationFamily(
        { declarationNo: candidate.declarationNo, declarationBranches: candidate.declarationBranches },
        number
      )
    )
  );
  const uniqueIds = new Set(matches.map((match) => match.id));
  return uniqueIds.size === 1 ? matches[0] : null;
}

export function matchOutputInvoiceToShipment(
  invoice: OutputInvoiceMatchSource,
  candidates: OutputShipmentCandidate[]
) {
  const buyerTaxCode = normalizeTaxCode(invoice.buyerTaxCode);
  const buyerName = normalizeCompanyName(invoice.buyerName);
  if (!buyerTaxCode && !buyerName) return null;

  const sameCustomer = candidates.filter((candidate) => {
    const candidateTaxCode = normalizeTaxCode(candidate.customer?.taxCode || candidate.taxCode);
    if (buyerTaxCode && candidateTaxCode) return buyerTaxCode === candidateTaxCode;
    const candidateName = normalizeCompanyName(candidate.customer?.companyName || candidate.customerName);
    return Boolean(buyerName && candidateName && buyerName === candidateName);
  });
  if (sameCustomer.length === 0) return null;

  const invoiceAmounts = [invoice.subtotal, invoice.totalAmount].filter(
    (amount): amount is number => typeof amount === "number" && amount > 0
  );
  const sameAmount = sameCustomer.filter((candidate) =>
    [...candidate.debts.map((debt) => debt.totalAmount), ...candidate.quotes.map((quote) => quote.quoteAmount)]
      .some((candidateAmount) => invoiceAmounts.some((amount) => amountsEqual(candidateAmount, amount)))
  );
  if (sameAmount.length === 1) return sameAmount[0];

  // Chỉ tự ghép theo khách hàng khi đúng một lô có khoản phải thu. Nếu có nhiều lô, hệ thống để
  // trạng thái chờ thay vì đoán và ghi nhận công nợ sai.
  if (sameCustomer.length === 1) return sameCustomer[0];
  return null;
}

export async function loadOutputShipmentCandidates(): Promise<OutputShipmentCandidate[]> {
  return prisma.shipment.findMany({
    select: {
      id: true,
      shipmentCode: true,
      declarationNo: true,
      declarationBranches: true,
      declarationDate: true,
      goodsName: true,
      customerName: true,
      taxCode: true,
      customer: { select: { companyName: true, taxCode: true } },
      debts: {
        where: { sourceKey: { startsWith: AUTOMATIC_RECEIVABLE_DEBT_PREFIX } },
        select: {
          id: true,
          sourceKey: true,
          totalAmount: true,
          status: true,
          dueDate: true,
          type: true,
        },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { quoteAmount: true },
      },
    },
  });
}

export async function findMatchingOutputShipment(invoice: OutputInvoiceMatchSource) {
  return matchOutputInvoiceToShipment(invoice, await loadOutputShipmentCandidates());
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
    select: { id: true, shipmentId: true, vendorId: true, invoiceNumber: true, updatedAt: true },
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
  // Only the seller on an input invoice is a supplier. For output invoices NQ itself is the seller,
  // so creating NQ as its own vendor or matching the row to a shipment cost would be incorrect.
  const vendor = parsed.invoiceDirection === "INPUT" ? await findOrCreateInvoiceVendor(parsed) : null;

  if (parsed.invoiceDirection === "OUTPUT") {
    const candidates = await loadOutputShipmentCandidates();
    // Ưu tiên khớp theo số tờ khai ghi trong nội dung hóa đơn (đúng lô tuyệt đối). Khi khớp được,
    // đánh dấu để caller cập nhật lại phần "Có hóa đơn" của phải thu = TỔNG mọi HĐ bán ra của lô
    // (sau khi hóa đơn này đã được lưu) — không ghi đè bằng một hóa đơn.
    const byDeclaration = matchOutputInvoiceByDeclaration(parsed, candidates);
    if (byDeclaration) {
      return {
        vendorId: null,
        shipmentCostId: null,
        shipmentId: byDeclaration.id,
        status: "MATCHED" as ReconciliationStatus,
        applyInvoicedReceivable: true,
      };
    }
    const shipment = matchOutputInvoiceToShipment(parsed, candidates);
    return {
      vendorId: null,
      shipmentCostId: null,
      shipmentId: shipment?.id ?? null,
      status: shipment ? "MATCHED" as ReconciliationStatus : "UNMATCHED" as ReconciliationStatus,
      applyInvoicedReceivable: false,
    };
  }

  if (parsed.invoiceDirection !== "INPUT" || !parsed.invoiceNumber) {
    return {
      vendorId: vendor?.id ?? null,
      shipmentCostId: null,
      shipmentId: null,
      status: "NEEDS_REVIEW" as ReconciliationStatus,
      applyInvoicedReceivable: false,
    };
  }

  const cost = await findMatchingShipmentCost(parsed.invoiceNumber, vendor?.id ?? null);
  if (!cost) {
    return {
      vendorId: vendor?.id ?? null,
      shipmentCostId: null,
      shipmentId: null,
      status: "UNMATCHED" as ReconciliationStatus,
      applyInvoicedReceivable: false,
    };
  }

  if (vendor && !cost.vendorId) {
    await prisma.shipmentCost.update({ where: { id: cost.id }, data: { vendorId: vendor.id } });
  }
  return {
    vendorId: vendor?.id ?? cost.vendorId ?? null,
    shipmentCostId: cost.id,
    shipmentId: cost.shipmentId,
    status: "MATCHED" as ReconciliationStatus,
    applyInvoicedReceivable: false,
  };
}

/**
 * Đặt phần "Có hóa đơn" của phải thu một lô = TỔNG tiền trước thuế của mọi hóa đơn bán ra đã gắn
 * vào lô (shipmentId set, shipmentCostId null = hóa đơn đầu ra), rồi đồng bộ lại công nợ. Idempotent:
 * gọi lại luôn ra cùng kết quả, và cộng đúng khi một lô có nhiều hóa đơn bán ra. Giữ nguyên phần
 * "Không hóa đơn" (quoteNoInvoiceAmount) để nhập tay.
 */
export async function recomputeShipmentInvoicedReceivable(shipmentId: string) {
  await prisma.$transaction(async (tx) => {
    const invoices = await tx.vendorInvoice.findMany({
      where: { shipmentId, shipmentCostId: null },
      select: { subtotal: true },
    });
    const sum = invoices.reduce((total, invoice) => total + (invoice.subtotal ?? 0), 0);
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { quoteInvoiceAmount: sum > 0 ? sum : null },
    });
    await syncPersonalAccountEntry(tx, shipmentId);
    await syncShipmentDebts(tx, shipmentId);
  });
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
      invoiceDirection: determineInvoiceDirection(
        invoice.sellerName,
        invoice.sellerTaxCode,
        invoice.buyerName,
        invoice.buyerTaxCode
      ),
      isIssuedToNq: invoice.isIssuedToNq,
      // Số tờ khai chỉ có khi parse XML lúc đồng bộ; bản lưu không giữ lại nên khớp lại dùng
      // khách+tiền như cũ (không tự sửa số phải thu ở luồng này).
      declarationNumbers: [],
    };
    const result = await reconcileParsedVendorInvoice(parsed);
    await prisma.vendorInvoice.update({
      where: { id: invoice.id },
      data: {
        vendorId: result.vendorId,
        shipmentCostId: result.shipmentCostId,
        shipmentId: invoice.shipmentId ?? result.shipmentId,
        status: invoice.shipmentId ? "MATCHED" : result.status,
      },
    });

    if (result.status === "MATCHED") summary.matched++;
    else if (result.status === "UNMATCHED") summary.unmatched++;
    else summary.needsReview++;
  }
  return summary;
}
