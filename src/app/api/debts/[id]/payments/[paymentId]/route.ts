import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { recomputeDebtStatus } from "@/lib/debt";
import { isAutomaticPayableDebt } from "@/lib/shipment-debt-sync";

// Delete a mis-recorded payment (audit 1.3), then recompute the debt's status from what's left so
// PAID/PARTIAL/UNPAID stays correct. ADMIN + ACCOUNTANT only (same as the rest of /api/debts).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xóa thanh toán.", 403);

    const { id, paymentId } = await params;
    const debt = await prisma.debt.findUnique({ where: { id }, select: { sourceKey: true } });
    if (!debt) return apiError("Không tìm thấy công nợ.", 404);
    if (user.role !== "ADMIN" && isAutomaticPayableDebt(debt.sourceKey)) {
      return apiError("Bạn không có quyền xóa thanh toán của công nợ chi phí tự động.", 403);
    }
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { debtId: true } });
    if (!payment || payment.debtId !== id) return apiError("Không tìm thấy khoản thanh toán.", 404);

    await prisma.payment.delete({ where: { id: paymentId } });
    const stats = await recomputeDebtStatus(id);

    return apiSuccess({ ok: true, ...stats });
  } catch (error) {
    console.error("DELETE /api/debts/[id]/payments/[paymentId] failed:", error);
    return apiError("Không thể xóa thanh toán.", 500);
  }
}
