import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { computeProfit } from "@/lib/shipment-cost-constants";
import { hasModuleAccess } from "@/lib/module-permissions";
import { summarizeInvoiceAmounts } from "@/lib/vendor-invoice-reconciliation";

// Lãi/lỗ contains costPrice-derived data and is therefore protected by the explicit REPORTS
// permission at both the page and API layers.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(user, "REPORTS")) return apiError("Bạn không có quyền xem báo cáo lãi lỗ.", 403);

  const shipments = await prisma.shipment.findMany({
    where: { declarationDate: { not: null } },
    select: {
      id: true,
      shipmentCode: true,
      customerName: true,
      declarationNo: true,
      declarationDate: true,
      goodsName: true,
      quoteInvoiceAmount: true,
      quoteInvoiceTaxAmount: true,
      quoteNoInvoiceAmount: true,
      costs: {
        select: {
          costPrice: true,
          sellPrice: true,
          isAdditional: true,
          isActual: true,
          vendorInvoices: { select: { subtotal: true, taxAmount: true, totalAmount: true } },
        },
      },
      quotes: { select: { quoteAmount: true, createdAt: true } },
      // Hóa đơn gắn thẳng vào lô (không gắn ShipmentCost) là hóa đơn đầu ra.
      // Đọc trực tiếp ở báo cáo để hóa đơn lịch sử cũng dùng đúng VAT thực tế mà không sửa sổ cũ.
      vendorInvoices: {
        where: { shipmentCostId: null },
        select: { subtotal: true, taxAmount: true, totalAmount: true },
      },
    },
    orderBy: { declarationDate: "desc" },
  });

  const rows = shipments.map((s) => {
    const costs = s.costs.map((cost) => ({
      ...cost,
      inputTaxAmount: cost.vendorInvoices.reduce((sum, invoice) => {
        const gross = Math.max(0, invoice.totalAmount ?? (invoice.subtotal ?? 0) + (invoice.taxAmount ?? 0));
        const subtotal = invoice.subtotal != null
          ? Math.max(0, invoice.subtotal)
          : Math.max(0, gross - (invoice.taxAmount ?? 0));
        return sum + Math.max(0, gross - subtotal);
      }, 0),
    }));
    const outputInvoiceTotals = summarizeInvoiceAmounts(s.vendorInvoices);
    const financials = computeProfit(costs, s.quotes, {
      quoteInvoiceAmount: outputInvoiceTotals.totalAmount > 0
        ? outputInvoiceTotals.subtotal
        : s.quoteInvoiceAmount,
      quoteInvoiceTaxAmount: outputInvoiceTotals.totalAmount > 0
        ? outputInvoiceTotals.taxAmount
        : s.quoteInvoiceTaxAmount,
      quoteNoInvoiceAmount: s.quoteNoInvoiceAmount,
    });
    return {
      id: s.id,
      shipmentCode: s.shipmentCode,
      customerName: s.customerName,
      declarationNo: s.declarationNo,
      declarationDate: s.declarationDate,
      goodsName: s.goodsName,
      ...financials,
    };
  });

  return apiSuccess(rows);
}
