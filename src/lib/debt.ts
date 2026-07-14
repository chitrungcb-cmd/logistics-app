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
