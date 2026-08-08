import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";
import { parseReportDateRange } from "@/lib/report-date-range";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";
import { AUTOMATIC_PAYABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";

type FlowKind = "RECEIPT" | "EXPENSE";

type ShipmentSummary = {
  id: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  customerName: string;
  invoiceNo: string | null;
};

type FlowTransaction = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountName: string | null;
  counterparty: string | null;
  invoiceNumber: string | null;
  note: string | null;
  attachmentUrl: string | null;
};

type ShipmentFlowGroup = {
  key: string;
  shipment: ShipmentSummary | null;
  fallbackLabel: string | null;
  totalAmount: number;
  transactionCount: number;
  latestTransactionDate: string;
  transactions: FlowTransaction[];
};

const SHIPMENT_SELECT = {
  id: true,
  declarationNo: true,
  declarationDate: true,
  goodsName: true,
  customerName: true,
  invoiceNo: true,
} as const;

function serializeShipment(shipment: {
  id: string;
  declarationNo: string | null;
  declarationDate: Date | null;
  goodsName: string | null;
  customerName: string;
  invoiceNo: string | null;
}): ShipmentSummary {
  return {
    ...shipment,
    declarationDate: shipment.declarationDate?.toISOString() ?? null,
  };
}

function addTransaction(
  groups: Map<string, ShipmentFlowGroup>,
  input: {
    key: string;
    shipment: ShipmentSummary | null;
    fallbackLabel?: string | null;
    transaction: FlowTransaction;
  }
) {
  const current = groups.get(input.key) ?? {
    key: input.key,
    shipment: input.shipment,
    fallbackLabel: input.fallbackLabel ?? null,
    totalAmount: 0,
    transactionCount: 0,
    latestTransactionDate: input.transaction.date,
    transactions: [],
  };

  current.totalAmount += input.transaction.amount;
  current.transactionCount += 1;
  current.transactions.push(input.transaction);
  if (new Date(input.transaction.date).getTime() > new Date(current.latestTransactionDate).getTime()) {
    current.latestTransactionDate = input.transaction.date;
  }
  groups.set(input.key, current);
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(currentUser, "REPORTS")) {
    return apiError("Bạn không có quyền xem báo cáo này.", 403);
  }

  const kind = request.nextUrl.searchParams.get("kind")?.trim().toUpperCase();
  if (kind !== "RECEIPT" && kind !== "EXPENSE") {
    return apiError("Loại giao dịch không hợp lệ.", 400);
  }

  const parsedRange = parseReportDateRange(request.nextUrl.searchParams);
  if (!parsedRange.ok) return apiError(parsedRange.error, 400);
  const range = parsedRange.range;
  const groups = new Map<string, ShipmentFlowGroup>();

  if (kind === "EXPENSE") {
    const expensePeriod = range
      ? {
          OR: [
            { paidAt: { gte: range.start, lt: range.endExclusive } },
            { paidAt: null, createdAt: { gte: range.start, lt: range.endExclusive } },
          ],
        }
      : {};
    const payablePaymentPeriod = range
      ? { paymentDate: { gte: range.start, lt: range.endExclusive } }
      : {};

    const costs = await prisma.shipmentCost.findMany({
      where: {
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
        invoiceNumber: true,
        attachmentUrl: true,
        note: true,
        shipment: { select: SHIPMENT_SELECT },
        vendor: { select: { name: true } },
        paidBy: { select: { name: true } },
        paidFromCompanyAccount: { select: { name: true } },
      },
    });

    for (const cost of costs) {
      const transactionDate = cost.paidAt ?? cost.createdAt;
      addTransaction(groups, {
        key: cost.shipment.id,
        shipment: serializeShipment(cost.shipment),
        transaction: {
          id: cost.id,
          date: transactionDate.toISOString(),
          amount: cost.costPrice,
          label: cost.customLabel || COST_CATEGORY_LABELS[cost.category] || cost.category,
          accountName: cost.paidBy?.name ?? cost.paidFromCompanyAccount?.name ?? null,
          counterparty: cost.vendor?.name ?? null,
          invoiceNumber: cost.invoiceNumber,
          note: cost.note,
          attachmentUrl: cost.attachmentUrl,
        },
      });
    }

    // Công nợ phải trả nhập tay không có các dòng ShipmentCost để tích isPaid; khoản Payment chính
    // là dòng tiền chi. Loại công nợ tự động được bỏ qua vì đã lấy từ ShipmentCost ở trên.
    const payablePayments = await prisma.payment.findMany({
      where: {
        ...payablePaymentPeriod,
        debt: {
          type: "PAYABLE",
          OR: [
            { sourceKey: null },
            { sourceKey: { not: { startsWith: AUTOMATIC_PAYABLE_DEBT_PREFIX } } },
          ],
        },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        method: true,
        note: true,
        attachmentUrl: true,
        receivedBy: { select: { name: true } },
        receivedToCompanyAccount: { select: { name: true } },
        debt: {
          select: {
            id: true,
            vendor: { select: { name: true } },
            shipment: { select: SHIPMENT_SELECT },
          },
        },
      },
    });
    for (const payment of payablePayments) {
      const shipment = payment.debt.shipment ? serializeShipment(payment.debt.shipment) : null;
      addTransaction(groups, {
        key: shipment?.id ?? `payable:${payment.debt.id}`,
        shipment,
        fallbackLabel: shipment ? null : payment.debt.vendor?.name || "Công nợ phải trả khác",
        transaction: {
          id: payment.id,
          date: payment.paymentDate.toISOString(),
          amount: payment.amount,
          label: "Thanh toán công nợ phải trả",
          accountName: payment.receivedBy?.name ?? payment.receivedToCompanyAccount?.name ?? null,
          counterparty: payment.debt.vendor?.name ?? null,
          invoiceNumber: shipment?.invoiceNo ?? null,
          note: [payment.method, payment.note].filter(Boolean).join(" · ") || null,
          attachmentUrl: payment.attachmentUrl,
        },
      });
    }

    const otherExpenses = await prisma.otherExpense.findMany({
      where: { type: "CHI", ...(range ? { expenseDate: { gte: range.start, lt: range.endExclusive } } : {}) },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, description: true, amount: true, expenseDate: true, payee: true,
        invoiceNumber: true, note: true, attachmentUrl: true,
        companyAccount: { select: { name: true } },
      },
    });
    for (const entry of otherExpenses) {
      addTransaction(groups, {
        key: "other-expenses",
        shipment: null,
        fallbackLabel: "Chi khác ngoài lô hàng",
        transaction: {
          id: entry.id, date: entry.expenseDate.toISOString(), amount: entry.amount,
          label: entry.description, accountName: entry.companyAccount?.name ?? null,
          counterparty: entry.payee, invoiceNumber: entry.invoiceNumber, note: entry.note,
          attachmentUrl: entry.attachmentUrl,
        },
      });
    }
  } else {
    const receiptPeriod = range
      ? { paymentDate: { gte: range.start, lt: range.endExclusive } }
      : {};

    const payments = await prisma.payment.findMany({
      where: { ...receiptPeriod, debt: { type: "RECEIVABLE" } },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        method: true,
        portion: true,
        attachmentUrl: true,
        note: true,
        receivedBy: { select: { name: true } },
        receivedToCompanyAccount: { select: { name: true } },
        debt: {
          select: {
            id: true,
            type: true,
            customer: { select: { companyName: true } },
            vendor: { select: { name: true } },
            shipment: { select: SHIPMENT_SELECT },
          },
        },
      },
    });

    for (const payment of payments) {
      const shipment = payment.debt.shipment
        ? serializeShipment(payment.debt.shipment)
        : null;
      const counterparty =
        payment.debt.customer?.companyName ??
        payment.debt.vendor?.name ??
        null;
      const portionLabel =
        payment.portion === "INVOICE"
          ? "Thu phần có hóa đơn"
          : payment.portion === "NO_INVOICE"
            ? "Thu phần không hóa đơn"
            : payment.debt.type === "RECEIVABLE"
              ? "Thu công nợ"
              : "Nhận hoàn tiền";

      addTransaction(groups, {
        key: shipment?.id ?? `debt:${payment.debt.id}`,
        shipment,
        fallbackLabel: shipment ? null : counterparty || "Công nợ chưa gắn lô",
        transaction: {
          id: payment.id,
          date: payment.paymentDate.toISOString(),
          amount: payment.amount,
          label: portionLabel,
          accountName:
            payment.receivedBy?.name ??
            payment.receivedToCompanyAccount?.name ??
            null,
          counterparty,
          invoiceNumber: shipment?.invoiceNo ?? null,
          note: [payment.method, payment.note].filter(Boolean).join(" · ") || null,
          attachmentUrl: payment.attachmentUrl,
        },
      });
    }

    const otherReceipts = await prisma.otherExpense.findMany({
      where: { type: "THU", ...(range ? { expenseDate: { gte: range.start, lt: range.endExclusive } } : {}) },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, description: true, amount: true, expenseDate: true, payee: true,
        invoiceNumber: true, note: true, attachmentUrl: true,
        companyAccount: { select: { name: true } },
      },
    });
    for (const entry of otherReceipts) {
      addTransaction(groups, {
        key: "other-receipts",
        shipment: null,
        fallbackLabel: "Thu khác ngoài lô hàng",
        transaction: {
          id: entry.id, date: entry.expenseDate.toISOString(), amount: entry.amount,
          label: entry.description, accountName: entry.companyAccount?.name ?? null,
          counterparty: entry.payee, invoiceNumber: entry.invoiceNumber, note: entry.note,
          attachmentUrl: entry.attachmentUrl,
        },
      });
    }
  }

  const rows = [...groups.values()]
    .map((group) => ({
      ...group,
      transactions: group.transactions.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    }))
    .sort((a, b) => {
      const declarationDifference =
        new Date(b.shipment?.declarationDate ?? 0).getTime() -
        new Date(a.shipment?.declarationDate ?? 0).getTime();
      return declarationDifference ||
        new Date(b.latestTransactionDate).getTime() -
          new Date(a.latestTransactionDate).getTime();
    });

  return apiSuccess({
    kind: kind as FlowKind,
    totalAmount: rows.reduce((sum, group) => sum + group.totalAmount, 0),
    shipmentCount: rows.filter((group) => group.shipment).length,
    transactionCount: rows.reduce((sum, group) => sum + group.transactionCount, 0),
    rows,
    period: range ? { from: range.from, to: range.to } : null,
  });
}
