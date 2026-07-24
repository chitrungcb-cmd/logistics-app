import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { validatePaymentAmount } from "@/lib/debt-constants";
import { recomputeDebtStatus, resolvePaymentReceivingAccount } from "@/lib/debt";
import { isAutomaticPayableDebt } from "@/lib/shipment-debt-sync";

// Sửa một khoản thanh toán đã ghi nhận (số tiền, phần có/không hóa đơn, ngày, phương thức, biên
// lai, ghi chú), rồi tính lại trạng thái công nợ. Quyền giống DELETE bên dưới.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa thanh toán.", 403);

    const { id, paymentId } = await params;
    const body = await request.json();
    const { amount, paymentDate, method, attachmentUrl, note } = body;

    if (!amount || Number(amount) <= 0) return apiError("Vui lòng nhập số tiền hợp lệ.", 400);
    if (!paymentDate) return apiError("Vui lòng chọn ngày thanh toán.", 400);

    const debt = await prisma.debt.findUnique({
      where: { id },
      include: { payments: { select: { id: true, amount: true, portion: true } } },
    });
    if (!debt) return apiError("Không tìm thấy công nợ.", 404);
    if (user.role !== "ADMIN" && isAutomaticPayableDebt(debt.sourceKey)) {
      return apiError("Bạn không có quyền sửa thanh toán của công nợ chi phí tự động.", 403);
    }
    if (!debt.payments.some((payment) => payment.id === paymentId)) {
      return apiError("Không tìm thấy khoản thanh toán.", 404);
    }

    const checked = validatePaymentAmount(debt, Number(amount), body.portion, paymentId);
    if ("error" in checked) return apiError(checked.error, 400);

    const account = await resolvePaymentReceivingAccount(body);
    if ("error" in account) return apiError(account.error, 400);

    const payment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        amount: Number(amount),
        paymentDate: new Date(paymentDate),
        method: method || null,
        portion: checked.portion,
        receivedToCompanyAccountId: account.receivedToCompanyAccountId,
        receivedByUserId: account.receivedByUserId,
        attachmentUrl: attachmentUrl || null,
        note: note || null,
      },
      include: {
        receivedToCompanyAccount: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
      },
    });

    const stats = await recomputeDebtStatus(id);
    return apiSuccess({ payment, ...stats });
  } catch (error) {
    console.error("PATCH /api/debts/[id]/payments/[paymentId] failed:", error);
    return apiError("Không thể sửa thanh toán.", 500);
  }
}

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
