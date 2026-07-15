import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem báo giá.", 403);
  const { id } = await params;
  return apiSuccess(await prisma.shipmentQuoteLine.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } }));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa báo giá.", 403);
    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.lines)) return apiError("Dữ liệu báo giá không hợp lệ.", 400);
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
    await prisma.$transaction(async (tx) => {
      await tx.shipmentQuoteLine.deleteMany({ where: { shipmentId: id } });
      for (const line of lines) {
        await tx.shipmentQuoteLine.create({
          data: { shipmentId: id, ...line, amount: line.quantity * line.unitPrice },
        });
      }
    });
    const saved = await prisma.shipmentQuoteLine.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });
    const total = saved.reduce((sum, line) => sum + line.amount, 0);
    await prisma.quote.create({ data: { shipmentId: id, quoteAmount: total, note: "Tổng hợp từ bảng báo giá chi tiết" } });
    return apiSuccess(saved);
  } catch (error) {
    console.error("PUT /api/shipments/[id]/quote-lines failed:", error);
    return apiError("Không thể lưu báo giá.", 500);
  }
}
