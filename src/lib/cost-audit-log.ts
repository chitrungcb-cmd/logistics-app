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
};

/** Compares only the fields actually present in `data` (a PATCH body) against the pre-update row. */
export function buildUpdateDetail(existing: CostSnapshot, data: Record<string, unknown>): string {
  const parts: string[] = [];
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
  if ("sellPrice" in data && data.sellPrice !== existing.sellPrice) {
    parts.push(`Giá bán: ${existing.sellPrice.toLocaleString("vi-VN")} → ${Number(data.sellPrice).toLocaleString("vi-VN")}`);
  }
  if ("isAdditional" in data && data.isAdditional !== existing.isAdditional) {
    parts.push(`Phát sinh ngoài báo giá: ${existing.isAdditional ? "Có" : "Không"} → ${data.isAdditional ? "Có" : "Không"}`);
  }
  if ("invoiceNumber" in data && data.invoiceNumber !== existing.invoiceNumber) {
    parts.push(`Số hóa đơn: "${existing.invoiceNumber || "—"}" → "${data.invoiceNumber || "—"}"`);
  }
  if ("note" in data && data.note !== existing.note) {
    parts.push("Ghi chú đã cập nhật");
  }
  if ("attachmentUrl" in data && data.attachmentUrl !== existing.attachmentUrl) {
    parts.push("Chứng từ đính kèm đã cập nhật");
  }
  return parts.length > 0 ? parts.join("; ") : "Cập nhật chi phí (không đổi giá trị)";
}
