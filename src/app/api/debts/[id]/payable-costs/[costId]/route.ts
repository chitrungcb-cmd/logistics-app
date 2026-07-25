import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Tích "đã thanh toán" cho một dòng chi phí trong công nợ Phải trả. Chỉ ADMIN hoặc đúng người được
// gán chi khoản đó ("Do ai chi" = paidBy) mới được tích. Không đụng tới số tiền/giá vốn.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; costId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền thao tác công nợ.", 403);

    const { id, costId } = await params;
    const debt = await prisma.debt.findUnique({ where: { id }, select: { type: true, shipmentId: true } });
    if (!debt) return apiError("Không tìm thấy công nợ.", 404);
    if (debt.type !== "PAYABLE") return apiError("Chỉ công nợ phải trả mới có danh sách chi phí.", 400);

    const cost = await prisma.shipmentCost.findUnique({
      where: { id: costId },
      select: { id: true, shipmentId: true, paidByUserId: true },
    });
    if (!cost || cost.shipmentId !== debt.shipmentId) {
      return apiError("Khoản chi phí không thuộc công nợ này.", 404);
    }
    // Chỉ người phụ trách khoản đó hoặc ADMIN được xác nhận.
    if (user.role !== "ADMIN" && cost.paidByUserId !== user.id) {
      return apiError("Chỉ người phụ trách khoản này mới được xác nhận đã thanh toán.", 403);
    }

    const body = await request.json();
    const isPaid = Boolean(body.isPaid);
    const updated = await prisma.shipmentCost.update({
      where: { id: costId },
      data: {
        isPaid,
        paidAt: isPaid ? new Date() : null,
        paidConfirmedByUserId: isPaid ? user.id : null,
      },
      select: {
        id: true,
        isPaid: true,
        paidAt: true,
        paidConfirmedBy: { select: { name: true } },
      },
    });
    return apiSuccess(updated);
  } catch (error) {
    console.error("PATCH /api/debts/[id]/payable-costs/[costId] failed:", error);
    return apiError("Không thể cập nhật trạng thái thanh toán.", 500);
  }
}
