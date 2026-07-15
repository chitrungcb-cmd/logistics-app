import { prisma } from "@/lib/prisma";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";

export async function logCostAudit(params: {
  userId: string;
  shipmentId: string;
  shipmentCostId: string | null;
  action: "CREATE" | "UPDATE" | "DELETE";
  detail: string;
}) {
  await prisma.costAuditLog.create({ data: params });
}

type CostSnapshot = {
  category: string;
  unitPrice: number;
  quantity: number;
  sellPrice: number;
  isAdditional: boolean;
  invoiceNumber: string | null;
  note: string | null;
  attachmentUrl: string | null;
  vendorId: string | null;
  isActual: boolean;
};

function quoted(value: unknown) {
  const text = value === null || value === undefined || value === "" ? "—" : String(value);
  return `"${text}"`;
}

function attachmentName(value: unknown) {
  if (!value) return "—";
  const text = String(value);
  return text.split("/").pop() || text;
}

/** Compares only the fields actually present in `data` (a PATCH body) against the pre-update row. */
export function buildUpdateDetail(
  existing: CostSnapshot,
  data: Record<string, unknown>,
  vendorNames?: { previous: string | null; next: string | null }
): string {
  const parts: string[] = [];
  const costLabel = COST_CATEGORY_LABELS[existing.category] ?? existing.category;
  const nextUnitPrice = "unitPrice" in data ? Number(data.unitPrice) : existing.unitPrice;
  const nextQuantity = "quantity" in data ? Number(data.quantity) : existing.quantity;
  if ("category" in data && data.category !== existing.category) {
    parts.push(
      `Danh mục: ${COST_CATEGORY_LABELS[existing.category] ?? existing.category} → ${
        COST_CATEGORY_LABELS[data.category as string] ?? data.category
      }`
    );
  }
  if ("unitPrice" in data && data.unitPrice !== existing.unitPrice) {
    parts.push(`Đơn giá: ${existing.unitPrice.toLocaleString("vi-VN")} → ${Number(data.unitPrice).toLocaleString("vi-VN")}`);
  }
  if ("quantity" in data && data.quantity !== existing.quantity) {
    parts.push(`Số lượng: ${existing.quantity} → ${data.quantity}`);
  }
  const previousTotal = existing.unitPrice * existing.quantity;
  const nextTotal = nextUnitPrice * nextQuantity;
  if (nextTotal !== previousTotal) {
    parts.push(`Tổng chi: ${previousTotal.toLocaleString("vi-VN")} → ${nextTotal.toLocaleString("vi-VN")}`);
  }
  if ("sellPrice" in data && data.sellPrice !== existing.sellPrice) {
    parts.push(`Tổng thu: ${existing.sellPrice.toLocaleString("vi-VN")} → ${Number(data.sellPrice).toLocaleString("vi-VN")}`);
  }
  if ("isAdditional" in data && data.isAdditional !== existing.isAdditional) {
    parts.push(`Phát sinh ngoài báo giá: ${existing.isAdditional ? "Có" : "Không"} → ${data.isAdditional ? "Có" : "Không"}`);
  }
  if ("invoiceNumber" in data && data.invoiceNumber !== existing.invoiceNumber) {
    parts.push(`Số hóa đơn: "${existing.invoiceNumber || "—"}" → "${data.invoiceNumber || "—"}"`);
  }
  if ("note" in data && data.note !== existing.note) {
    parts.push(`Ghi chú: ${quoted(existing.note)} → ${quoted(data.note)}`);
  }
  if ("attachmentUrl" in data && data.attachmentUrl !== existing.attachmentUrl) {
    parts.push(`Chứng từ: ${quoted(attachmentName(existing.attachmentUrl))} → ${quoted(attachmentName(data.attachmentUrl))}`);
  }
  if ("vendorId" in data && data.vendorId !== existing.vendorId) {
    parts.push(`Nhà cung cấp: ${quoted(vendorNames?.previous)} → ${quoted(vendorNames?.next)}`);
  }
  if ("isActual" in data && data.isActual !== existing.isActual) {
    parts.push(`Trạng thái: ${existing.isActual ? "Thực tế" : "Dự kiến"} → ${data.isActual ? "Thực tế" : "Dự kiến"}`);
  }
  return parts.length > 0
    ? `Sửa tay [${costLabel}] — ${parts.join("; ")}`
    : `Sửa tay [${costLabel}] — không đổi giá trị`;
}
