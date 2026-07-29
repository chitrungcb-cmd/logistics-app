import { getGoodsKeyword } from "@/lib/goods-keyword";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";

export type CostVarianceInput = {
  id: string;
  shipmentId: string;
  category: string;
  customLabel: string | null;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  costPrice: number;
  vendorName: string | null;
  declarationNo: string | null;
  declarationDate: Date | string | null;
  customerName: string;
  goodsName: string | null;
  port: string | null;
};

export type CostVarianceSeverity = "REVIEW" | "HIGH" | "VERY_HIGH";

export type CostVarianceRow = {
  key: string;
  goodsKeyword: string;
  category: string;
  categoryLabel: string;
  unit: string;
  shipmentCount: number;
  lineCount: number;
  minUnitPrice: number;
  medianUnitPrice: number;
  averageUnitPrice: number;
  maxUnitPrice: number;
  varianceAmount: number;
  variancePercent: number;
  potentialSaving: number;
  severity: CostVarianceSeverity;
  details: Array<CostVarianceInput & { differenceFromMedian: number; differencePercent: number }>;
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function comparableCategory(cost: CostVarianceInput) {
  if (cost.category !== "KHAC") return cost.category;
  return `${cost.category}:${normalizeText(cost.customLabel) || "KHAC"}`;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function severityOf(percent: number): CostVarianceSeverity {
  if (percent >= 100) return "VERY_HIGH";
  if (percent >= 50) return "HIGH";
  return "REVIEW";
}

/**
 * Chỉ so sánh đơn giá thực tế giữa ít nhất hai lô khác nhau có cùng nhóm hàng, hạng mục và ĐVT.
 * Nhờ vậy một khoản tính "mỗi xe" không bị so sai với khoản tính cho "cả lô".
 */
export function buildCostVarianceReport(costs: CostVarianceInput[], minVariancePercent = 30) {
  const groups = new Map<string, CostVarianceInput[]>();
  for (const cost of costs) {
    const goodsKeyword = getGoodsKeyword(cost.goodsName);
    if (!goodsKeyword || cost.unitPrice <= 0 || cost.quantity <= 0 || cost.costPrice <= 0) continue;
    const unitKey = normalizeText(cost.unit) || "LO";
    const key = `${goodsKeyword}|${comparableCategory(cost)}|${unitKey}`;
    const group = groups.get(key) ?? [];
    group.push(cost);
    groups.set(key, group);
  }

  const rows: CostVarianceRow[] = [];
  for (const [key, group] of groups) {
    const shipmentCount = new Set(group.map((cost) => cost.shipmentId)).size;
    if (shipmentCount < 2) continue;

    const unitPrices = group.map((cost) => cost.unitPrice);
    const minUnitPrice = Math.min(...unitPrices);
    const maxUnitPrice = Math.max(...unitPrices);
    if (minUnitPrice <= 0 || maxUnitPrice <= minUnitPrice) continue;

    const varianceAmount = maxUnitPrice - minUnitPrice;
    const variancePercent = (varianceAmount / minUnitPrice) * 100;
    if (variancePercent < minVariancePercent) continue;

    const medianUnitPrice = median(unitPrices);
    const averageUnitPrice = unitPrices.reduce((sum, value) => sum + value, 0) / unitPrices.length;
    const representative = group[0];
    const details = [...group]
      .sort((a, b) => b.unitPrice - a.unitPrice)
      .map((cost) => {
        const differenceFromMedian = cost.unitPrice - medianUnitPrice;
        return {
          ...cost,
          differenceFromMedian,
          differencePercent: medianUnitPrice > 0 ? (differenceFromMedian / medianUnitPrice) * 100 : 0,
        };
      });

    rows.push({
      key,
      goodsKeyword: getGoodsKeyword(representative.goodsName)!,
      category: representative.category,
      categoryLabel:
        representative.category === "KHAC" && representative.customLabel
          ? representative.customLabel
          : COST_CATEGORY_LABELS[representative.category] ?? representative.category,
      unit: representative.unit?.trim() || "Lô",
      shipmentCount,
      lineCount: group.length,
      minUnitPrice,
      medianUnitPrice,
      averageUnitPrice,
      maxUnitPrice,
      varianceAmount,
      variancePercent,
      potentialSaving: group.reduce(
        (sum, cost) => sum + Math.max(0, cost.unitPrice - medianUnitPrice) * cost.quantity,
        0
      ),
      severity: severityOf(variancePercent),
      details,
    });
  }

  rows.sort((a, b) => b.variancePercent - a.variancePercent || b.varianceAmount - a.varianceAmount);
  return {
    rows,
    totals: {
      groupCount: rows.length,
      shipmentCount: new Set(rows.flatMap((row) => row.details.map((detail) => detail.shipmentId))).size,
      lineCount: rows.reduce((sum, row) => sum + row.lineCount, 0),
      maxVariancePercent: rows[0]?.variancePercent ?? 0,
      potentialSaving: rows.reduce((sum, row) => sum + row.potentialSaving, 0),
    },
  };
}
