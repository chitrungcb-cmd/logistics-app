import { prisma } from "@/lib/prisma";
import { computeDebtStatus, sumPayments } from "@/lib/debt-constants";

/**
 * Recomputes and persists a debt's UNPAID/PARTIAL/PAID status from its CURRENT payments, and returns
 * the fresh paid/remaining/status so the caller doesn't have to re-derive them. Shared by both the
 * payment-create and payment-delete routes so the "sum payments → computeDebtStatus → update" logic
 * lives in exactly one place. Call it AFTER the payment row has been created/deleted.
 */
export async function recomputeDebtStatus(debtId: string) {
  const debt = await prisma.debt.findUnique({
    where: { id: debtId },
    select: { totalAmount: true, payments: { select: { amount: true } } },
  });
  if (!debt) return null;

  const paidAmount = sumPayments(debt.payments);
  const status = computeDebtStatus(debt.totalAmount, paidAmount);
  await prisma.debt.update({ where: { id: debtId }, data: { status } });

  return { paidAmount, remainingAmount: debt.totalAmount - paidAmount, status };
}

/**
 * Chuẩn hóa + kiểm tra "TK nhận tiền" của một khoản thanh toán: thu vào TK công ty hoặc TK cá nhân
 * của một người, LOẠI TRỪ NHAU (TK công ty ưu tiên nếu gửi cả hai). Dùng chung cho POST/PATCH payment.
 */
export async function resolvePaymentReceivingAccount(body: {
  receivedToCompanyAccountId?: unknown;
  receivedByUserId?: unknown;
}): Promise<{ receivedToCompanyAccountId: string | null; receivedByUserId: string | null } | { error: string }> {
  const companyId =
    typeof body.receivedToCompanyAccountId === "string" && body.receivedToCompanyAccountId ? body.receivedToCompanyAccountId : null;
  const userId = typeof body.receivedByUserId === "string" && body.receivedByUserId ? body.receivedByUserId : null;

  if (companyId) {
    if (!(await prisma.companyAccount.findUnique({ where: { id: companyId }, select: { id: true } }))) {
      return { error: "Tài khoản công ty không hợp lệ." };
    }
    return { receivedToCompanyAccountId: companyId, receivedByUserId: null };
  }
  if (userId) {
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      return { error: "Người nhận tiền không hợp lệ." };
    }
    return { receivedToCompanyAccountId: null, receivedByUserId: userId };
  }
  return { receivedToCompanyAccountId: null, receivedByUserId: null };
}
