import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { sumPayments } from "@/lib/debt-constants";
import { recomputeDebtStatus } from "@/lib/debt";
import { isAutomaticPayableDebt } from "@/lib/shipment-debt-sync";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền ghi nhận thanh toán.", 403);

    const { id } = await params;
    const body = await request.json();
    const { amount, paymentDate, method, attachmentUrl, note } = body;

    if (!amount || Number(amount) <= 0) return apiError("Vui lòng nhập số tiền hợp lệ.", 400);
    if (!paymentDate) return apiError("Vui lòng chọn ngày thanh toán.", 400);

    const debt = await prisma.debt.findUnique({ where: { id }, include: { payments: { select: { amount: true } } } });
    if (!debt) return apiError("Không tìm thấy công nợ.", 404);
    if (user.role !== "ADMIN" && isAutomaticPayableDebt(debt.sourceKey)) {
      return apiError("Bạn không có quyền ghi nhận thanh toán cho công nợ chi phí tự động.", 403);
    }

    // Block over-payment (audit 3.4) so "Còn lại" can never go negative.
    const remaining = debt.totalAmount - sumPayments(debt.payments);
    if (Number(amount) > remaining) {
      return apiError(`Số tiền vượt quá số còn lại (${remaining.toLocaleString("vi-VN")} đ).`, 400);
    }

    const payment = await prisma.payment.create({
      data: {
        debtId: id,
        amount: Number(amount),
        paymentDate: new Date(paymentDate),
        method: method || null,
        attachmentUrl: attachmentUrl || null,
        note: note || null,
      },
    });

    const stats = await recomputeDebtStatus(id);
    return apiSuccess({ payment, ...stats }, 201);
  } catch (error) {
    console.error("POST /api/debts/[id]/payments failed:", error);
    return apiError("Không thể ghi nhận thanh toán.", 500);
  }
}
