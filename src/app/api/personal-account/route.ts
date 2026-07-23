import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { PERSONAL_ACCOUNT_ENTRY_INCLUDE, computePersonalAccountPayment } from "@/lib/personal-account-sync";
import { AUTOMATIC_RECEIVABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";

/**
 * Gắn trạng thái thanh toán cho từng dòng từ các khoản thu phần KHÔNG HÓA ĐƠN đã ghi trong Công nợ
 * (công nợ phải thu tự đồng bộ của cùng lô). Đây là nguồn chính — trước đây bảng chỉ dựa vào ô ngày
 * điền tay nên không phản ánh khi khách đã trả qua module Công nợ.
 */
async function attachPaymentStatus<T extends { shipmentId: string; amount: number; paymentDate: Date | null }>(
  entries: T[]
) {
  if (entries.length === 0) return [];
  const debts = await prisma.debt.findMany({
    where: {
      type: "RECEIVABLE",
      shipmentId: { in: entries.map((entry) => entry.shipmentId) },
      sourceKey: { startsWith: AUTOMATIC_RECEIVABLE_DEBT_PREFIX },
    },
    select: {
      shipmentId: true,
      payments: { where: { portion: "NO_INVOICE" }, select: { amount: true, paymentDate: true } },
    },
  });
  const paymentsByShipment = new Map(debts.map((debt) => [debt.shipmentId, debt.payments]));

  return entries.map((entry) => ({
    ...entry,
    ...computePersonalAccountPayment({
      amount: entry.amount,
      noInvoicePayments: paymentsByShipment.get(entry.shipmentId) ?? [],
      manualPaymentDate: entry.paymentDate,
    }),
  }));
}

/**
 * Bù dòng cho các lô đã nhập ô "Không hóa đơn" nhưng chưa có dòng theo dõi (ví dụ dòng bị xóa tay
 * trong DB, hoặc dữ liệu có trước một lần đổi logic). Chạy lười mỗi lần mở danh sách (app kiểu
 * serverless không có hook "on startup" — cùng lý do với ensureCompanyConversation); chỉ tạo dòng
 * còn thiếu, không đụng vào dòng đã tồn tại. Chỉ dựa vào `quoteNoInvoiceAmount` nhập tay — không
 * suy diễn từ cờ hóa đơn của bảng chi tiết (xem syncPersonalAccountEntry).
 */
async function backfillPersonalAccountEntries() {
  const shipments = await prisma.shipment.findMany({
    where: {
      personalAccountEntry: null,
      quoteNoInvoiceAmount: { gt: 0 },
    },
    select: {
      id: true,
      quoteNoInvoiceAmount: true,
      customer: { select: { assignedUser: { select: { id: true, isActive: true } } } },
    },
  });
  const rows = shipments.map((shipment) => ({
    shipmentId: shipment.id,
    amount: shipment.quoteNoInvoiceAmount ?? 0,
    assignedUserId: shipment.customer?.assignedUser?.isActive
      ? shipment.customer.assignedUser.id
      : null,
  }));
  if (rows.length > 0) {
    await prisma.personalAccountEntry.createMany({ data: rows, skipDuplicates: true });
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem tài khoản cá nhân.", 403);

    await backfillPersonalAccountEntries();
    const entries = await prisma.personalAccountEntry.findMany({
      include: PERSONAL_ACCOUNT_ENTRY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(await attachPaymentStatus(entries));
  } catch (error) {
    console.error("GET /api/personal-account failed:", error);
    return apiError("Không thể tải danh sách tài khoản cá nhân.", 500);
  }
}
