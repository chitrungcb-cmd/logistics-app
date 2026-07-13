export const DEBT_TYPE_OPTIONS = ["RECEIVABLE", "PAYABLE"] as const;

export const DEBT_TYPE_LABELS: Record<string, string> = {
  RECEIVABLE: "Phải thu",
  PAYABLE: "Phải trả",
};

export const DEBT_STATUS_OPTIONS = ["UNPAID", "PARTIAL", "PAID"] as const;

export const DEBT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Chưa thanh toán",
  PARTIAL: "Thanh toán một phần",
  PAID: "Đã thanh toán",
};

export const DEBT_STATUS_BADGE_CLASS: Record<string, string> = {
  UNPAID: "bg-gray-100 text-gray-600",
  PARTIAL: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
};

export const OVERDUE_BADGE_CLASS = "bg-red-100 text-red-700";
export const OVERDUE_LABEL = "Quá hạn";

/** Only ever UNPAID/PARTIAL/PAID are stored — always re-derived from paidAmount server-side. */
export function computeDebtStatus(totalAmount: number, paidAmount: number): "UNPAID" | "PARTIAL" | "PAID" {
  if (paidAmount <= 0) return "UNPAID";
  if (paidAmount >= totalAmount) return "PAID";
  return "PARTIAL";
}

/** "Quá hạn" is a display-only flag layered on top of status, not a stored enum value — a debt that's
 * PARTIAL and past its dueDate is both PARTIAL and overdue at once. */
export function isOverdue(status: string, dueDate: string | Date | null | undefined) {
  if (status === "PAID" || !dueDate) return false;
  return new Date(dueDate).getTime() < Date.now();
}

/** Effective badge for the /debts table: overdue always wins visually over UNPAID/PARTIAL. */
export function debtStatusBadge(status: string, dueDate: string | Date | null | undefined) {
  if (isOverdue(status, dueDate)) {
    return { label: OVERDUE_LABEL, className: OVERDUE_BADGE_CLASS };
  }
  return { label: DEBT_STATUS_LABELS[status] ?? status, className: DEBT_STATUS_BADGE_CLASS[status] ?? "bg-gray-100 text-gray-600" };
}

export function sumPayments(payments: { amount: number }[]) {
  return payments.reduce((sum, p) => sum + p.amount, 0);
}
