import type { Prisma } from "@/generated/prisma/client";

/** Include dùng chung cho mọi response trả về một dòng tài khoản cá nhân. */
export const PERSONAL_ACCOUNT_ENTRY_INCLUDE = {
  shipment: {
    select: {
      id: true,
      shipmentCode: true,
      declarationNo: true,
      declarationDate: true,
      goodsName: true,
      customerName: true,
    },
  },
  assignedUser: { select: { id: true, name: true } },
} as const;

/**
 * Trạng thái thanh toán của một dòng tài khoản cá nhân, suy ra từ các khoản thanh toán phần KHÔNG
 * HÓA ĐƠN đã ghi trong Công nợ. Đây là nguồn duy nhất cho ngày và trạng thái thanh toán. Trả về cả
 * số đã thu / còn lại để bảng hiển thị "thu một phần".
 */
export function computePersonalAccountPayment(params: {
  amount: number;
  noInvoicePayments: Array<{ amount: number; paymentDate: Date | string }>;
}): {
  paidAmount: number;
  remainingAmount: number;
  paidStatus: "paid" | "partial" | "unpaid";
  effectivePaymentDate: string | null;
} {
  const paidAmount = params.noInvoicePayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = Math.max(0, params.amount - paidAmount);

  const paidStatus =
    params.amount > 0 && paidAmount >= params.amount
      ? "paid"
      : paidAmount > 0
        ? "partial"
        : "unpaid";

  const latestDebtDate = params.noInvoicePayments.length > 0
    ? params.noInvoicePayments
        .map((p) => new Date(p.paymentDate).getTime())
        .reduce((a, b) => Math.max(a, b), 0)
    : null;
  const effectivePaymentDate = latestDebtDate != null ? new Date(latestDebtDate).toISOString() : null;

  return { paidAmount, remainingAmount, paidStatus, effectivePaymentDate };
}

export type QuoteSplitSource = {
  quoteInvoiceAmount: number | null;
  quoteInvoiceTaxAmount?: number | null;
  quoteNoInvoiceAmount: number | null;
  quoteLines: Array<{ amount: number; hasInvoice: boolean }>;
};

/**
 * Chế độ nhập tay được kích hoạt khi một trong hai giá trị phân bổ khác null — khi đó ô để trống
 * được hiểu là 0 chứ không rơi về tổng dòng, để hai ô nhập tay luôn nhất quán với nhau.
 */
export function isManualQuoteSplit(shipment: Pick<QuoteSplitSource, "quoteInvoiceAmount" | "quoteNoInvoiceAmount">) {
  return shipment.quoteInvoiceAmount != null || shipment.quoteNoInvoiceAmount != null;
}

/** Thuế suất VAT của phần có hóa đơn — ô nhập tay là số CHƯA VAT, khách trả thêm 8% trên số đó. */
export const INVOICE_VAT_RATE = 0.08;

/** Thuế VAT: ưu tiên số thực tế từ hóa đơn; chỉ dùng 8% khi người dùng nhập báo giá thủ công. */
export function computeInvoiceVat(
  quoteInvoiceAmount: number | null | undefined,
  explicitTaxAmount?: number | null
): number {
  if (explicitTaxAmount != null) return Math.max(0, Math.round(explicitTaxAmount));
  return Math.round((quoteInvoiceAmount ?? 0) * INVOICE_VAT_RATE);
}

/** Phần có hóa đơn sau VAT, làm tròn về đồng (VND không có phần lẻ). */
export function resolveInvoiceAmountWithVat(
  quoteInvoiceAmount: number | null | undefined,
  explicitTaxAmount?: number | null
): number {
  return Math.round(quoteInvoiceAmount ?? 0) + computeInvoiceVat(quoteInvoiceAmount, explicitTaxAmount);
}

/**
 * Tổng báo giá: đã nhập tay thì = có hóa đơn ĐÃ CỘNG VAT 8% + không hóa đơn (phần không hóa đơn
 * không chịu VAT); chưa nhập tay thì là tổng thành tiền của bảng chi tiết.
 */
export function resolveQuoteTotal(shipment: QuoteSplitSource): number {
  if (isManualQuoteSplit(shipment)) {
    return resolveInvoiceAmountWithVat(
      shipment.quoteInvoiceAmount,
      shipment.quoteInvoiceTaxAmount
    ) + (shipment.quoteNoInvoiceAmount ?? 0);
  }
  return shipment.quoteLines.reduce((sum, line) => sum + line.amount, 0);
}

/**
 * Đồng bộ dòng "Tài khoản cá nhân" của một lô theo ô "Không hóa đơn" NHẬP TAY (`quoteNoInvoiceAmount`)
 * — cột hóa đơn theo từng dòng đã bị bỏ khỏi UI nên không suy ra số này từ bảng chi tiết nữa (mọi
 * dòng mới đều mặc định hasInvoice=false, suy diễn sẽ tạo dòng theo dõi sai cho cả lô chưa phân bổ).
 * Gọi bên trong cùng transaction với thao tác lưu báo giá. Chỉ `amount` được đồng bộ — ngày thanh
 * toán, số TK nhận tiền, người phụ trách là dữ liệu điền tay và không bao giờ bị ghi đè ở đây. Khi
 * phần không hóa đơn về 0, dòng chưa thanh toán bị xóa; dòng đã có ngày thanh toán được giữ lại
 * (kèm amount 0) để không mất lịch sử tiền đã chuyển.
 */
export async function syncPersonalAccountEntry(tx: Prisma.TransactionClient, shipmentId: string) {
  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      quoteNoInvoiceAmount: true,
      customer: { select: { assignedUser: { select: { id: true, isActive: true } } } },
      personalAccountEntry: { select: { id: true, paymentDate: true } },
    },
  });
  if (!shipment) return;

  const amount = shipment.quoteNoInvoiceAmount ?? 0;
  const existing = shipment.personalAccountEntry;

  if (amount <= 0) {
    if (!existing) return;
    if (existing.paymentDate) {
      await tx.personalAccountEntry.update({ where: { id: existing.id }, data: { amount: 0 } });
    } else {
      await tx.personalAccountEntry.delete({ where: { id: existing.id } });
    }
    return;
  }

  if (existing) {
    await tx.personalAccountEntry.update({ where: { id: existing.id }, data: { amount } });
    return;
  }

  const defaultAssignee = shipment.customer?.assignedUser;
  await tx.personalAccountEntry.create({
    data: {
      shipmentId,
      amount,
      assignedUserId: defaultAssignee?.isActive ? defaultAssignee.id : null,
    },
  });
}
