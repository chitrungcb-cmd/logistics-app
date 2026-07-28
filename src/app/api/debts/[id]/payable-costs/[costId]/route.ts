import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Tích "đã thanh toán" cho một dòng chi phí trong công nợ Phải trả. ADMIN, đúng TK chi cá nhân,
// hoặc ACCOUNTANT với TK công ty được xác nhận. Không đụng tới số tiền/giá vốn.
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
      select: {
        id: true,
        shipmentId: true,
        paidByUserId: true,
        paidFromCompanyAccountId: true,
        isPaid: true,
        paidAt: true,
      },
    });
    if (!cost || cost.shipmentId !== debt.shipmentId) {
      return apiError("Khoản chi phí không thuộc công nợ này.", 404);
    }
    const canConfirm =
      user.role === "ADMIN" ||
      cost.paidByUserId === user.id ||
      (user.role === "ACCOUNTANT" && cost.paidFromCompanyAccountId !== null);
    if (!canConfirm) {
      return apiError("Chỉ người phụ trách TK chi mới được xác nhận đã thanh toán.", 403);
    }

    const body = await request.json();
    const isPaid = "isPaid" in body ? Boolean(body.isPaid) : cost.isPaid;
    let paidAt: Date | null = null;
    if (isPaid) {
      if ("paidAt" in body) {
        if (typeof body.paidAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.paidAt)) {
          return apiError("Ngày thanh toán không hợp lệ.", 400);
        }
        paidAt = new Date(body.paidAt);
        if (Number.isNaN(paidAt.getTime())) {
          return apiError("Ngày thanh toán không hợp lệ.", 400);
        }
      } else {
        paidAt = cost.paidAt ?? new Date();
      }
    }
    const updated = await prisma.shipmentCost.update({
      where: { id: costId },
      data: {
        isPaid,
        paidAt,
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
