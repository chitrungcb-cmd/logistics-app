import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";
import { parseReportDateRange } from "@/lib/report-date-range";
import { AUTOMATIC_PAYABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";

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

  const parsedRange = parseReportDateRange(request.nextUrl.searchParams);
  if (!parsedRange.ok) return apiError(parsedRange.error, 400);
  const range = parsedRange.range;
  const expensePeriod = range
    ? {
        OR: [
          { paidAt: { gte: range.start, lt: range.endExclusive } },
          { paidAt: null, createdAt: { gte: range.start, lt: range.endExclusive } },
        ],
      }
    : {};
  const receiptPeriod = range
    ? { paymentDate: { gte: range.start, lt: range.endExclusive } }
    : {};
  const transferPeriod = range
    ? { transferDate: { gte: range.start, lt: range.endExclusive } }
    : {};

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
        isPaid: true,
        costPrice: { gt: 0 },
        ...expensePeriod,
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
        attachmentUrl: true,
        vendor: { select: { name: true } },
        shipment: { select: SHIPMENT_SELECT },
      },
    }),
    prisma.payment.findMany({
      where: {
        receivedByUserId: personId,
        OR: [
          { debt: { type: "RECEIVABLE" } },
          {
            debt: {
              type: "PAYABLE",
              OR: [
                { sourceKey: null },
                { sourceKey: { not: { startsWith: AUTOMATIC_PAYABLE_DEBT_PREFIX } } },
              ],
            },
          },
        ],
        ...receiptPeriod,
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        method: true,
        note: true,
        attachmentUrl: true,
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
        ...transferPeriod,
      },
      orderBy: [{ transferDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        type: true,
        transferDate: true,
        amount: true,
        note: true,
        attachmentName: true,
        attachmentUrl: true,
        createdAt: true,
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
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
      attachmentUrl: expense.attachmentUrl,
      shipment: expense.shipment,
    })),
    ...receipts.map((receipt) => ({
      id: `receipt:${receipt.id}`,
      type: receipt.debt.type === "RECEIVABLE" ? ("RECEIPT" as const) : ("EXPENSE" as const),
      date: receipt.paymentDate,
      amount: receipt.amount,
      label: receipt.debt.type === "RECEIVABLE" ? "Nhận tiền khách hàng" : "Thanh toán công nợ phải trả",
      counterparty: receipt.debt.customer?.companyName ?? receipt.debt.vendor?.name ?? null,
      invoiceNumber: null,
      note: [receipt.method, receipt.note].filter(Boolean).join(" · ") || null,
      attachmentUrl: receipt.attachmentUrl,
      shipment: receipt.debt.shipment,
    })),
    ...transfers.map((transfer) => {
      const isIncoming = transfer.toUser.id === personId;
      return {
        id: `transfer:${transfer.id}`,
        type: isIncoming ? ("TRANSFER_IN" as const) : ("TRANSFER_OUT" as const),
        date: transfer.transferDate,
        amount: transfer.amount,
        label:
          transfer.type === "ADVANCE"
            ? (isIncoming ? "Nhận tạm ứng" : "Đã tạm ứng")
            : (isIncoming ? "Nhận hoàn ứng" : "Hoàn ứng"),
        counterparty: isIncoming ? transfer.fromUser.name : transfer.toUser.name,
        invoiceNumber: null,
        note: transfer.note,
        attachmentName: transfer.attachmentName,
        attachmentUrl: transfer.attachmentUrl,
        recordedBy: transfer.createdBy?.name ?? null,
        recordedAt: transfer.createdAt,
        shipment: null,
      };
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return apiSuccess({
    person,
    entries,
  });
}
