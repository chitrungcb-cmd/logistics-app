import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";
import { resolveQuoteTotal, syncPersonalAccountEntry } from "@/lib/personal-account-sync";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem báo giá.", 403);
  const { id } = await params;
  const shipment = await prisma.shipment.findUnique({
    where: { id },
    select: {
      quoteInvoiceAmount: true,
      quoteInvoiceTaxAmount: true,
      quoteNoInvoiceAmount: true,
      quoteLines: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!shipment) return apiError("Không tìm thấy lô hàng.", 404);
  return apiSuccess({
    lines: shipment.quoteLines,
    invoiceAmount: shipment.quoteInvoiceAmount,
    invoiceTaxAmount: shipment.quoteInvoiceTaxAmount,
    noInvoiceAmount: shipment.quoteNoInvoiceAmount,
  });
}

function parseManualAmount(value: unknown): number | null | undefined {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa báo giá.", 403);
    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.lines)) return apiError("Dữ liệu báo giá không hợp lệ.", 400);
    const invoiceAmount = parseManualAmount(body.invoiceAmount);
    const noInvoiceAmount = parseManualAmount(body.noInvoiceAmount);
    if (invoiceAmount === undefined || noInvoiceAmount === undefined) {
      return apiError("Số tiền có hóa đơn / không hóa đơn phải là số không âm.", 400);
    }
    const lines = body.lines
      .map((line: { description?: unknown; quantity?: unknown; unit?: unknown; unitPrice?: unknown; hasInvoice?: unknown; note?: unknown }) => ({
        description: typeof line.description === "string" ? line.description.trim() : "",
        quantity: Number(line.quantity) || 0,
        unit: typeof line.unit === "string" ? line.unit.trim() || null : null,
        unitPrice: Number(line.unitPrice) || 0,
        hasInvoice: Boolean(line.hasInvoice),
        note: typeof line.note === "string" ? line.note.trim() || null : null,
      }))
      .filter((line: { description: string }) => line.description.length > 0);
    if (lines.some((line: { quantity: number; unitPrice: number }) => line.quantity < 0 || line.unitPrice < 0)) {
      return apiError("Số lượng và đơn giá không được âm.", 400);
    }
    const existingShipment = await prisma.shipment.findUnique({ where: { id }, select: { id: true } });
    if (!existingShipment) return apiError("Không tìm thấy lô hàng.", 404);
    const saved = await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id },
        // Nhập báo giá thủ công dùng VAT mặc định 8%; xóa VAT thực tế cũ (nếu trước đó được lấy từ
        // hóa đơn điện tử) để resolveQuoteTotal tính lại đúng theo lựa chọn mới của người dùng.
        data: {
          quoteInvoiceAmount: invoiceAmount,
          quoteInvoiceTaxAmount: null,
          quoteNoInvoiceAmount: noInvoiceAmount,
        },
      });
      await tx.shipmentQuoteLine.deleteMany({ where: { shipmentId: id } });
      for (const line of lines) {
        await tx.shipmentQuoteLine.create({
          data: { shipmentId: id, ...line, amount: line.quantity * line.unitPrice },
        });
      }
      const currentLines = await tx.shipmentQuoteLine.findMany({
        where: { shipmentId: id },
        orderBy: { createdAt: "asc" },
      });
      // Tổng báo giá = có hóa đơn (chưa VAT) + không hóa đơn khi đã nhập tay; nếu chưa nhập tay
      // thì vẫn là tổng bảng chi tiết như trước.
      const total = resolveQuoteTotal({
        quoteInvoiceAmount: invoiceAmount,
        quoteInvoiceTaxAmount: null,
        quoteNoInvoiceAmount: noInvoiceAmount,
        quoteLines: currentLines,
      });
      await tx.quote.create({
        data: { shipmentId: id, quoteAmount: total, note: "Tổng hợp từ bảng báo giá chi tiết" },
      });
      await syncPersonalAccountEntry(tx, id);
      await syncShipmentDebts(tx, id);
      return { lines: currentLines, invoiceAmount, noInvoiceAmount };
    });
    return apiSuccess(saved);
  } catch (error) {
    console.error("PUT /api/shipments/[id]/quote-lines failed:", error);
    return apiError("Không thể lưu báo giá.", 500);
  }
}
