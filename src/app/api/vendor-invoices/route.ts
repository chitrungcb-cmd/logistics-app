import { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { determineInvoiceDirection, type InvoiceDirection } from "@/lib/vendor-invoice-parser";
import {
  loadOutputShipmentCandidates,
  matchOutputInvoiceToShipment,
} from "@/lib/vendor-invoice-reconciliation";
import { AUTOMATIC_PAYABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";

const STATUSES = new Set(["MATCHED", "UNMATCHED", "NEEDS_REVIEW"]);

function getMonthRange(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) return null;
  return {
    gte: new Date(Date.UTC(year, month - 1, 1)),
    lt: new Date(Date.UTC(year, month, 1)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem hóa đơn đối tác.", 403);

    const search = request.nextUrl.searchParams.get("search")?.trim() || null;
    const vendorId = request.nextUrl.searchParams.get("vendorId")?.trim() || null;
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus && STATUSES.has(rawStatus) ? rawStatus as "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW" : null;
    const monthRange = getMonthRange(request.nextUrl.searchParams.get("month"));
    const nq = request.nextUrl.searchParams.get("nq");
    const rawDirection = request.nextUrl.searchParams.get("direction");
    const direction = ["INPUT", "OUTPUT", "UNRELATED", "UNKNOWN"].includes(rawDirection || "")
      ? rawDirection as InvoiceDirection
      : null;

    const where: Prisma.VendorInvoiceWhereInput = {
      vendorId: vendorId ?? undefined,
      status: status ?? undefined,
      invoiceDate: monthRange ?? undefined,
      isIssuedToNq: nq === "true" ? true : nq === "false" ? false : undefined,
      OR: search
        ? [
            { sellerName: { contains: search, mode: "insensitive" } },
            { sellerTaxCode: { contains: search, mode: "insensitive" } },
            { buyerName: { contains: search, mode: "insensitive" } },
            { buyerTaxCode: { contains: search, mode: "insensitive" } },
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { emailSubject: { contains: search, mode: "insensitive" } },
            { vendor: { name: { contains: search, mode: "insensitive" } } },
            { shipmentCost: { shipment: { declarationNo: { contains: search, mode: "insensitive" } } } },
            { shipmentCost: { shipment: { goodsName: { contains: search, mode: "insensitive" } } } },
          ]
        : undefined,
    };

    const [invoices, partners, outputShipmentCandidates] = await Promise.all([
      prisma.vendorInvoice.findMany({
        where,
        include: {
          vendor: { select: { id: true, name: true, taxCode: true, type: true } },
          shipmentCost: {
            select: {
              id: true,
              category: true,
              costPrice: true,
              invoiceNumber: true,
              shipment: {
                select: {
                  id: true,
                  declarationNo: true,
                  declarationDate: true,
                  goodsName: true,
                  customerName: true,
                },
              },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        take: 500,
      }),
      prisma.vendor.findMany({
        where: { invoices: { some: {} } },
        include: {
          invoices: {
            select: { totalAmount: true, status: true, isIssuedToNq: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      loadOutputShipmentCandidates(),
    ]);

    const shipmentIds = Array.from(new Set(
      invoices.flatMap((invoice) => invoice.shipmentCost?.shipment.id ? [invoice.shipmentCost.shipment.id] : [])
    ));
    const payableDebts = shipmentIds.length > 0
      ? await prisma.debt.findMany({
          where: { sourceKey: { in: shipmentIds.map((shipmentId) => `${AUTOMATIC_PAYABLE_DEBT_PREFIX}${shipmentId}`) } },
          select: { id: true, sourceKey: true, totalAmount: true, status: true, dueDate: true },
        })
      : [];
    const payableDebtByShipment = new Map(
      payableDebts.map((debt) => [debt.sourceKey?.slice(AUTOMATIC_PAYABLE_DEBT_PREFIX.length), debt])
    );

    const classifiedInvoices = invoices.map((invoice) => {
      const invoiceDirection = determineInvoiceDirection(
        invoice.sellerName,
        invoice.sellerTaxCode,
        invoice.buyerName,
        invoice.buyerTaxCode
      );
      const persistedOutputShipment = invoice.shipmentId
        ? outputShipmentCandidates.find((shipment) => shipment.id === invoice.shipmentId) ?? null
        : null;
      const outputShipment = invoiceDirection === "OUTPUT"
        ? persistedOutputShipment ?? matchOutputInvoiceToShipment(invoice, outputShipmentCandidates)
        : null;
      const linkedShipment = invoiceDirection === "INPUT"
        ? invoice.shipmentCost?.shipment ?? null
        : outputShipment
          ? {
              id: outputShipment.id,
              shipmentCode: outputShipment.shipmentCode,
              declarationNo: outputShipment.declarationNo,
              declarationDate: outputShipment.declarationDate,
              goodsName: outputShipment.goodsName,
              customerName: outputShipment.customerName,
            }
          : null;
      const note = invoiceDirection === "OUTPUT"
        ? outputShipment
          ? "Hóa đơn đầu ra đã liên kết với lô hàng và khoản phải thu của khách hàng."
          : "Chưa đủ dữ liệu để xác định duy nhất lô hàng của hóa đơn bán ra."
        : invoiceDirection === "UNRELATED"
          ? "NQ Logistics không phải bên bán hoặc bên mua; cần kiểm tra hóa đơn."
          : invoiceDirection === "UNKNOWN"
            ? "Chưa xác định được hóa đơn đầu vào hay đầu ra; cần kiểm tra MST bên bán và bên mua."
            : null;
      const inputPayableDebt = invoiceDirection === "INPUT" && invoice.shipmentCost
        ? payableDebtByShipment.get(invoice.shipmentCost.shipment.id) ?? null
        : null;
      const linkedDebt = invoiceDirection === "OUTPUT"
        ? outputShipment?.debts[0] ?? null
        : inputPayableDebt;
      return { ...invoice, invoiceDirection, note, linkedShipment, linkedDebt };
    });
    const invoiceRows = direction
      ? classifiedInvoices.filter((invoice) => invoice.invoiceDirection === direction)
      : classifiedInvoices;

    const totals = invoiceRows.reduce(
      (acc, invoice) => {
        acc.count++;
        if (invoice.invoiceDirection === "INPUT") {
          acc.inputCount++;
          acc.inputAmount += invoice.totalAmount ?? 0;
          if (invoice.status === "MATCHED") acc.matched++;
          else if (invoice.status === "UNMATCHED") acc.unmatched++;
          else acc.needsReview++;
        } else if (invoice.invoiceDirection === "OUTPUT") {
          acc.outputCount++;
          acc.outputAmount += invoice.totalAmount ?? 0;
        } else {
          acc.needsReview++;
        }
        return acc;
      },
      {
        count: 0,
        inputCount: 0,
        outputCount: 0,
        matched: 0,
        unmatched: 0,
        needsReview: 0,
        inputAmount: 0,
        outputAmount: 0,
      }
    );

    const partnerRows = partners.map(({ invoices: partnerInvoices, ...partner }) => ({
      ...partner,
      invoiceCount: partnerInvoices.length,
      matchedCount: partnerInvoices.filter((invoice) => invoice.status === "MATCHED").length,
      totalAmount: partnerInvoices.reduce(
        (total, invoice) => total + (invoice.isIssuedToNq === false ? 0 : invoice.totalAmount ?? 0),
        0
      ),
    }));

    const shipmentOptions = outputShipmentCandidates.map((shipment) => ({
      id: shipment.id,
      declarationNo: shipment.declarationNo,
      goodsName: shipment.goodsName,
      customerName: shipment.customer?.companyName || shipment.customerName,
      taxCode: shipment.customer?.taxCode || shipment.taxCode,
      quoteAmount: shipment.quotes[0]?.quoteAmount ?? null,
    }));

    return apiSuccess({ invoices: invoiceRows, totals, partners: partnerRows, shipmentOptions });
  } catch (error) {
    console.error("GET /api/vendor-invoices failed:", error);
    return apiError("Không thể tải danh sách hóa đơn đối tác.", 500);
  }
}
