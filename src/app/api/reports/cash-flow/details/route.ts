import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";

const SHIPMENT_SELECT = {
  id: true,
  declarationNo: true,
  declarationDate: true,
  goodsName: true,
  customerName: true,
} as const;

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(currentUser, "REPORTS")) {
    return apiError("Bạn không có quyền xem báo cáo này.", 403);
  }

  const personId = request.nextUrl.searchParams.get("personId")?.trim();
  if (!personId) return apiError("Thiếu người cần xem.", 400);

  const person = await prisma.user.findUnique({
    where: { id: personId },
    select: { id: true, name: true },
  });
  if (!person) return apiError("Không tìm thấy người sử dụng.", 404);

  const [expenses, receipts, transfers] = await Promise.all([
    prisma.shipmentCost.findMany({
      where: {
        paidByUserId: personId,
        isActual: true,
        costPrice: { gt: 0 },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        category: true,
        customLabel: true,
        costPrice: true,
        paidAt: true,
        createdAt: true,
        note: true,
        invoiceNumber: true,
        vendor: { select: { name: true } },
        shipment: { select: SHIPMENT_SELECT },
      },
    }),
    prisma.payment.findMany({
      where: { receivedByUserId: personId },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        method: true,
        note: true,
        debt: {
          select: {
            type: true,
            customer: { select: { companyName: true } },
            vendor: { select: { name: true } },
            shipment: { select: SHIPMENT_SELECT },
          },
        },
      },
    }),
    prisma.internalTransfer.findMany({
      where: {
        OR: [{ fromUserId: personId }, { toUserId: personId }],
      },
      orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        transferDate: true,
        amount: true,
        note: true,
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        shipment: { select: SHIPMENT_SELECT },
      },
    }),
  ]);

  const entries = [
    ...expenses.map((expense) => ({
      id: `expense:${expense.id}`,
      type: "EXPENSE" as const,
      date: expense.paidAt ?? expense.createdAt,
      amount: expense.costPrice,
      label: expense.customLabel || COST_CATEGORY_LABELS[expense.category] || expense.category,
      counterparty: expense.vendor?.name ?? null,
      invoiceNumber: expense.invoiceNumber,
      note: expense.note,
      shipment: expense.shipment,
    })),
    ...receipts.map((receipt) => ({
      id: `receipt:${receipt.id}`,
      type: "RECEIPT" as const,
      date: receipt.paymentDate,
      amount: receipt.amount,
      label: receipt.debt.type === "RECEIVABLE" ? "Nhận tiền khách hàng" : "Nhận hoàn tiền",
      counterparty: receipt.debt.customer?.companyName ?? receipt.debt.vendor?.name ?? null,
      invoiceNumber: null,
      note: [receipt.method, receipt.note].filter(Boolean).join(" · ") || null,
      shipment: receipt.debt.shipment,
    })),
    ...transfers.map((transfer) => {
      const isIncoming = transfer.toUser.id === personId;
      return {
        id: `transfer:${transfer.id}`,
        type: isIncoming ? ("TRANSFER_IN" as const) : ("TRANSFER_OUT" as const),
        date: transfer.transferDate,
        amount: transfer.amount,
        label: isIncoming ? "Nhận chuyển nội bộ" : "Chuyển nội bộ",
        counterparty: isIncoming ? transfer.fromUser.name : transfer.toUser.name,
        invoiceNumber: null,
        note: transfer.note,
        shipment: transfer.shipment,
      };
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return apiSuccess({ person, entries });
}
