import type { Prisma } from "@/generated/prisma/client";
import { computeDebtStatus, sumPayments } from "@/lib/debt-constants";

export const AUTOMATIC_RECEIVABLE_DEBT_PREFIX = "SHIPMENT_RECEIVABLE:";
export const AUTOMATIC_PAYABLE_DEBT_PREFIX = "SHIPMENT_PAYABLE:";

export function isAutomaticDebt(sourceKey: string | null | undefined) {
  return Boolean(
    sourceKey?.startsWith(AUTOMATIC_RECEIVABLE_DEBT_PREFIX) ||
    sourceKey?.startsWith(AUTOMATIC_PAYABLE_DEBT_PREFIX)
  );
}

export function isAutomaticPayableDebt(sourceKey: string | null | undefined) {
  return Boolean(sourceKey?.startsWith(AUTOMATIC_PAYABLE_DEBT_PREFIX));
}

function debtKey(type: "RECEIVABLE" | "PAYABLE", shipmentId: string) {
  return `${
    type === "RECEIVABLE" ? AUTOMATIC_RECEIVABLE_DEBT_PREFIX : AUTOMATIC_PAYABLE_DEBT_PREFIX
  }${shipmentId}`;
}

async function findAutomaticDebt(
  tx: Prisma.TransactionClient,
  sourceKey: string
) {
  return tx.debt.findUnique({
    where: { sourceKey },
    include: { payments: { select: { amount: true } } },
  });
}

async function adoptSingleManualDebt(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  type: "RECEIVABLE" | "PAYABLE",
  sourceKey: string
) {
  // Nếu lô đã có đúng một công nợ nhập tay cùng loại, biến nó thành bản đồng bộ thay vì tạo trùng.
  const manualCandidates = await tx.debt.findMany({
    where: { shipmentId, type, sourceKey: null },
    include: { payments: { select: { amount: true } } },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (manualCandidates.length !== 1) return null;

  return tx.debt.update({
    where: { id: manualCandidates[0].id },
    data: { sourceKey },
    include: { payments: { select: { amount: true } } },
  });
}

async function syncOneDebt(params: {
  tx: Prisma.TransactionClient;
  shipmentId: string;
  type: "RECEIVABLE" | "PAYABLE";
  amount: number;
  customerId: string | null;
  canCreate: boolean;
}) {
  const sourceKey = debtKey(params.type, params.shipmentId);
  let existing = await findAutomaticDebt(params.tx, sourceKey);

  if (!existing && !params.canCreate) return null;
  if (!existing) {
    existing = await adoptSingleManualDebt(
      params.tx,
      params.shipmentId,
      params.type,
      sourceKey
    );
  }

  if (params.amount <= 0) {
    if (existing && sumPayments(existing.payments) <= 0) {
      await params.tx.debt.delete({ where: { id: existing.id } });
    }
    return null;
  }

  const paidAmount = existing ? sumPayments(existing.payments) : 0;
  // Không hạ tổng nợ xuống dưới số đã thanh toán vì sẽ tạo số dư âm và làm sai lịch sử thanh toán.
  const totalAmount = Math.max(params.amount, paidAmount);
  const status = computeDebtStatus(totalAmount, paidAmount);

  return params.tx.debt.upsert({
    where: { sourceKey },
    create: {
      sourceKey,
      type: params.type,
      shipmentId: params.shipmentId,
      customerId: params.type === "RECEIVABLE" ? params.customerId : null,
      vendorId: null,
      totalAmount,
      status,
      note: params.type === "RECEIVABLE"
        ? "Tự động đồng bộ từ báo giá lô hàng."
        : "Tự động đồng bộ từ chi phí thực tế của lô hàng.",
    },
    update: {
      shipmentId: params.shipmentId,
      customerId: params.type === "RECEIVABLE" ? params.customerId : null,
      vendorId: null,
      totalAmount,
      status,
    },
  });
}

/**
 * Tạo cặp công nợ lần đầu chỉ khi lô đã có báo giá dương và mọi dòng chi phí đã lưu đều là chi phí
 * thực tế dương. Sau khi đã liên kết, các lần sửa tiếp theo luôn cập nhật lại đúng tổng nguồn.
 */
export async function syncShipmentDebts(tx: Prisma.TransactionClient, shipmentId: string) {
  // Nhiều ô chi phí có thể tự lưu đồng thời. Advisory lock tuần tự hóa việc tính tổng theo từng lô.
  // Keep PostgreSQL's native `void` lock value inside the CTE because Prisma 7 cannot deserialize it.
  await tx.$queryRaw`
    WITH lock_row AS (
      SELECT pg_advisory_xact_lock(hashtext(${shipmentId}))
    )
    SELECT 1::int AS "locked" FROM lock_row
  `;

  const shipment = await tx.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      customerId: true,
      costs: { select: { costPrice: true, isActual: true } },
      quoteLines: { select: { amount: true } },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { quoteAmount: true },
      },
    },
  });
  if (!shipment) return { ready: false, receivable: null, payable: null };

  const latestQuoteAmount = shipment.quotes[0]?.quoteAmount ?? 0;
  const quoteLinesComplete = shipment.quoteLines.length === 0 ||
    shipment.quoteLines.every((line) => line.amount > 0);
  const costsComplete = shipment.costs.length > 0 &&
    shipment.costs.every((cost) => cost.isActual && cost.costPrice > 0);
  const ready = latestQuoteAmount > 0 && quoteLinesComplete && costsComplete;
  const actualCostTotal = shipment.costs
    .filter((cost) => cost.isActual && cost.costPrice > 0)
    .reduce((sum, cost) => sum + cost.costPrice, 0);

  const receivable = await syncOneDebt({
    tx,
    shipmentId,
    type: "RECEIVABLE",
    amount: latestQuoteAmount,
    customerId: shipment.customerId,
    canCreate: ready,
  });
  const payable = await syncOneDebt({
    tx,
    shipmentId,
    type: "PAYABLE",
    amount: actualCostTotal,
    customerId: null,
    canCreate: ready,
  });

  return { ready, receivable, payable };
}
