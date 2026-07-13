export const COST_CATEGORY_OPTIONS = [
  "HAI_QUAN",
  "BIEN_PHONG",
  "KIEM_DICH",
  "HA_TANG",
  "BEN_BAI",
  "SANG_TAI",
  "VAN_TAI",
  "HOA_HONG",
  "KHAC",
] as const;

export const COST_CATEGORY_LABELS: Record<string, string> = {
  HAI_QUAN: "Hải quan",
  BIEN_PHONG: "Biên phòng",
  KIEM_DICH: "Kiểm dịch",
  HA_TANG: "Hạ tầng",
  BEN_BAI: "Bến bãi",
  SANG_TAI: "Sang tải",
  VAN_TAI: "Vận tải",
  HOA_HONG: "Hoa hồng",
  KHAC: "Khác",
};

// One distinct pastel color per category so the /costs table's category badges are visually scannable.
export const COST_CATEGORY_BADGE_CLASS: Record<string, string> = {
  HAI_QUAN: "bg-blue-100 text-blue-700",
  BIEN_PHONG: "bg-purple-100 text-purple-700",
  KIEM_DICH: "bg-cyan-100 text-cyan-700",
  HA_TANG: "bg-indigo-100 text-indigo-700",
  BEN_BAI: "bg-amber-100 text-amber-700",
  SANG_TAI: "bg-rose-100 text-rose-700",
  VAN_TAI: "bg-emerald-100 text-emerald-700",
  HOA_HONG: "bg-lime-100 text-lime-700",
  KHAC: "bg-pink-100 text-pink-700",
};

// Purely decorative — no data meaning, just a visual anchor next to the category label.
export const COST_CATEGORY_ICON: Record<string, string> = {
  HAI_QUAN: "🛃",
  BIEN_PHONG: "🪖",
  KIEM_DICH: "🧪",
  HA_TANG: "🏗️",
  BEN_BAI: "🅿️",
  SANG_TAI: "🚛",
  VAN_TAI: "🚚",
  HOA_HONG: "🤝",
  KHAC: "📦",
};

type CostLike = { costPrice: number; sellPrice: number; isAdditional: boolean };
type QuoteLike = { quoteAmount: number; createdAt: Date | string };

/**
 * Tổng thu khách hàng = quoteAmount of the most recent Quote (0 if none) + sellPrice of costs
 * marked isAdditional (charges outside the original quote). Tổng chi phí = costPrice of every
 * ShipmentCost row regardless of isAdditional — the quote-covered costs still count as real spend.
 */
export function computeProfit(costs: CostLike[], quotes: QuoteLike[]) {
  const latestQuote = [...quotes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  const quoteAmount = latestQuote?.quoteAmount ?? 0;
  const additionalSell = costs.filter((c) => c.isAdditional).reduce((sum, c) => sum + c.sellPrice, 0);
  const totalRevenue = quoteAmount + additionalSell;
  const totalCost = costs.reduce((sum, c) => sum + c.costPrice, 0);
  return { quoteAmount, additionalSell, totalRevenue, totalCost, profit: totalRevenue - totalCost };
}
