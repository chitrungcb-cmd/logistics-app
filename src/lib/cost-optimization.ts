import { getGoodsKeyword } from "@/lib/goods-keyword";

export type OptimizableCost = {
  id: string;
  shipmentId: string;
  category: string;
  unitPrice: number;
  quantity: number;
  createdAt: string;
  shipment: { goodsName: string | null };
};

export type CostOpportunity = {
  costId: string;
  benchmarkUnitPrice: number;
  potentialSaving: number;
  differencePercent: number;
  sampleCount: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  benchmarkScope: "SIMILAR_GOODS" | "CATEGORY";
};

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const MIN_DIFFERENCE_PERCENT = 10;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Finds review opportunities without mutating costs. A same-product benchmark needs at least two
 * peer shipments; the category fallback needs at least three and is deliberately marked low
 * confidence. Tiny differences (<=10%) are ignored to avoid noisy recommendations.
 */
export function calculateCostOpportunities(
  costs: OptimizableCost[],
  now = new Date()
): CostOpportunity[] {
  const cutoff = now.getTime() - SIX_MONTHS_MS;

  return costs.flatMap((cost) => {
    if (cost.unitPrice <= 0 || cost.quantity <= 0 || new Date(cost.createdAt).getTime() < cutoff) return [];

    const goodsKeyword = getGoodsKeyword(cost.shipment.goodsName);
    const categoryPeers = costs.filter(
      (peer) =>
        peer.id !== cost.id &&
        peer.shipmentId !== cost.shipmentId &&
        peer.category === cost.category &&
        peer.unitPrice > 0 &&
        new Date(peer.createdAt).getTime() >= cutoff
    );
    const similarPeers = goodsKeyword
      ? categoryPeers.filter((peer) => getGoodsKeyword(peer.shipment.goodsName) === goodsKeyword)
      : [];

    const benchmarkPeers = similarPeers.length >= 2 ? similarPeers : categoryPeers.length >= 3 ? categoryPeers : [];
    if (benchmarkPeers.length === 0) return [];

    const benchmarkUnitPrice = median(benchmarkPeers.map((peer) => peer.unitPrice));
    if (benchmarkUnitPrice <= 0 || cost.unitPrice <= benchmarkUnitPrice) return [];

    const differencePercent = ((cost.unitPrice - benchmarkUnitPrice) / benchmarkUnitPrice) * 100;
    if (differencePercent <= MIN_DIFFERENCE_PERCENT) return [];

    const usesSimilarGoods = benchmarkPeers === similarPeers;
    return [
      {
        costId: cost.id,
        benchmarkUnitPrice,
        potentialSaving: (cost.unitPrice - benchmarkUnitPrice) * cost.quantity,
        differencePercent,
        sampleCount: benchmarkPeers.length,
        confidence: usesSimilarGoods ? (benchmarkPeers.length >= 5 ? "HIGH" : "MEDIUM") : "LOW",
        benchmarkScope: usesSimilarGoods ? "SIMILAR_GOODS" : "CATEGORY",
      } satisfies CostOpportunity,
    ];
  }).sort((a, b) => b.potentialSaving - a.potentialSaving);
}
