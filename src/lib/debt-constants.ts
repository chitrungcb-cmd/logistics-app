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

export const DEBT_PORTION_OPTIONS = ["INVOICE", "NO_INVOICE"] as const;
export type DebtPortionValue = (typeof DEBT_PORTION_OPTIONS)[number];

export const DEBT_PORTION_LABELS: Record<string, string> = {
  INVOICE: "Có hóa đơn",
  NO_INVOICE: "Không hóa đơn",
};

/** Công nợ có tách hóa đơn khi ít nhất một trong hai phần được đặt (đồng bộ từ báo giá có split). */
export function hasInvoiceSplit(debt: { invoiceAmount: number | null; noInvoiceAmount: number | null }) {
  return debt.invoiceAmount != null || debt.noInvoiceAmount != null;
}

export function sumPaymentsByPortion(
  payments: { amount: number; portion?: string | null }[],
  portion: DebtPortionValue
) {
  return payments
    .filter((payment) => payment.portion === portion)
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/**
 * Đã trả / còn lại theo từng phần cho công nợ tách hóa đơn. Trả về null nếu công nợ không tách —
 * gọi bên phải kiểm tra hasInvoiceSplit trước hoặc dùng null để hiển thị công nợ tổng như cũ.
 */
export function computeInvoiceSplitBreakdown(debt: {
  invoiceAmount: number | null;
  noInvoiceAmount: number | null;
  payments: { amount: number; portion?: string | null }[];
}) {
  if (!hasInvoiceSplit(debt)) return null;
  const invoiceAmount = debt.invoiceAmount ?? 0;
  const noInvoiceAmount = debt.noInvoiceAmount ?? 0;
  const paidInvoice = sumPaymentsByPortion(debt.payments, "INVOICE");
  const paidNoInvoice = sumPaymentsByPortion(debt.payments, "NO_INVOICE");
  return {
    invoiceAmount,
    noInvoiceAmount,
    paidInvoice,
    paidNoInvoice,
    remainingInvoice: invoiceAmount - paidInvoice,
    remainingNoInvoice: noInvoiceAmount - paidNoInvoice,
  };
}

type PaymentRow = { id?: string; amount: number; portion?: string | null };

type DebtForPaymentCheck = {
  totalAmount: number;
  invoiceAmount: number | null;
  noInvoiceAmount: number | null;
  payments: PaymentRow[];
};

/**
 * Kiểm tra một khoản thanh toán (tạo mới hoặc sửa) có vượt số còn lại không, và trả về `portion`
 * đã chuẩn hóa. Công nợ tách hóa đơn phải chỉ rõ phần và chỉ được vượt tối đa số còn lại của CHÍNH
 * phần đó; công nợ không tách trừ vào tổng chung (portion null). Khi sửa, truyền `excludePaymentId`
 * để chính khoản đang sửa không bị tính vào "đã trả" — nếu không, sửa 30tr thành 31tr sẽ bị chặn oan.
 * Trả về `{ error }` để route trả nguyên văn cho người dùng, hoặc `{ portion }` khi hợp lệ.
 */
export function validatePaymentAmount(
  debt: DebtForPaymentCheck,
  amount: number,
  requestedPortion: unknown,
  excludePaymentId?: string
): { error: string } | { portion: DebtPortionValue | null } {
  const others = excludePaymentId
    ? debt.payments.filter((payment) => payment.id !== excludePaymentId)
    : debt.payments;

  if (hasInvoiceSplit(debt)) {
    if (!DEBT_PORTION_OPTIONS.includes(requestedPortion as DebtPortionValue)) {
      return { error: "Vui lòng chọn phần thanh toán (có hóa đơn / không hóa đơn)." };
    }
    const portion = requestedPortion as DebtPortionValue;
    const portionTotal = (portion === "INVOICE" ? debt.invoiceAmount : debt.noInvoiceAmount) ?? 0;
    const portionRemaining = portionTotal - sumPaymentsByPortion(others, portion);
    if (amount > portionRemaining) {
      return {
        error: `Số tiền vượt quá số còn lại của phần "${DEBT_PORTION_LABELS[portion]}" (${portionRemaining.toLocaleString("vi-VN")} đ).`,
      };
    }
    return { portion };
  }

  // Block over-payment (audit 3.4) so "Còn lại" can never go negative.
  const remaining = debt.totalAmount - sumPayments(others);
  if (amount > remaining) {
    return { error: `Số tiền vượt quá số còn lại (${remaining.toLocaleString("vi-VN")} đ).` };
  }
  return { portion: null };
}
