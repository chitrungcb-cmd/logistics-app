import { computeInvoiceVat, isManualQuoteSplit } from "@/lib/personal-account-sync";

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

// Theo nghiệp vụ, chỉ các nhóm này phát sinh chi phí có hóa đơn.
export const INVOICE_COST_CATEGORIES = ["KIEM_DICH", "HA_TANG", "SANG_TAI", "BEN_BAI", "VAN_TAI"] as const;

export function isInvoiceCostCategory(category: string) {
  return INVOICE_COST_CATEGORIES.some((item) => item === category);
}

// Các khoản nộp trực tiếp cho cơ quan/chức năng nhà nước không được theo dõi như công nợ nhà cung cấp.
export const VENDORLESS_COST_CATEGORIES = ["HAI_QUAN", "BIEN_PHONG", "KIEM_DICH", "HA_TANG"] as const;

export function isVendorlessCostCategory(category: string) {
  return VENDORLESS_COST_CATEGORIES.some((item) => item === category);
}

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

type CostLike = {
  costPrice: number;
  sellPrice: number;
  isAdditional: boolean;
  isActual?: boolean;
  /** VAT đầu vào thực tế của các hóa đơn đã khớp với khoản chi này. */
  inputTaxAmount?: number;
};
type QuoteLike = { quoteAmount: number; createdAt: Date | string };
type RevenueTaxSplit = {
  quoteInvoiceAmount: number | null;
  quoteInvoiceTaxAmount?: number | null;
  quoteNoInvoiceAmount: number | null;
};

/**
 * Tổng thu khách hàng = quoteAmount of the most recent Quote (0 if none) + sellPrice of costs
 * marked isAdditional (charges outside the original quote). Tổng chi phí = costPrice of every
 * ShipmentCost row regardless of isAdditional — the quote-covered costs still count as real spend.
 */
export function computeProfit(costs: CostLike[], quotes: QuoteLike[], split?: RevenueTaxSplit) {
  // Dòng preset chưa được xác nhận chỉ là dự toán, không được trộn vào báo cáo lãi/lỗ thực tế.
  // Call site cũ không truyền isActual vẫn được xem là thực tế để tương thích.
  const actualCosts = costs.filter((cost) => cost.isActual !== false);
  const latestQuote = [...quotes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  const revenueVatSeparated = Boolean(split && isManualQuoteSplit(split));
  // Khi đã có phân tách báo giá/hóa đơn thì lấy chính các thành phần đó làm nguồn chuẩn.
  // Nhờ vậy báo cáo không phụ thuộc vào một bản Quote lịch sử có thể chưa được tạo lại.
  const quoteAmount = revenueVatSeparated && split
    ? Math.max(0, split.quoteInvoiceAmount ?? 0)
      + computeInvoiceVat(split.quoteInvoiceAmount, split.quoteInvoiceTaxAmount)
      + Math.max(0, split.quoteNoInvoiceAmount ?? 0)
    : latestQuote?.quoteAmount ?? 0;
  const additionalSell = actualCosts
    .filter((c) => c.isAdditional)
    .reduce((sum, c) => sum + c.sellPrice, 0);

  const outputVat = revenueVatSeparated && split
    ? computeInvoiceVat(split.quoteInvoiceAmount, split.quoteInvoiceTaxAmount)
    : 0;
  const totalRevenueGross = quoteAmount + additionalSell;
  const totalRevenueNet = Math.max(0, totalRevenueGross - outputVat);

  const totalCostGross = actualCosts.reduce((sum, c) => sum + c.costPrice, 0);
  const inputVat = actualCosts.reduce(
    (sum, cost) => sum + Math.min(Math.max(0, cost.inputTaxAmount ?? 0), Math.max(0, cost.costPrice)),
    0
  );
  const totalCostNet = Math.max(0, totalCostGross - inputVat);
  const profitGross = totalRevenueGross - totalCostGross;
  const profitNet = totalRevenueNet - totalCostNet;

  return {
    quoteAmount,
    additionalSell,
    outputVat,
    inputVat,
    totalRevenueGross,
    totalRevenueNet,
    totalCostGross,
    totalCostNet,
    profitGross,
    profitNet,
    revenueVatSeparated,
    // Khóa cũ giữ nguyên nghĩa "dòng tiền gồm VAT" cho những màn hình chưa nâng cấp.
    totalRevenue: totalRevenueGross,
    totalCost: totalCostGross,
    profit: profitGross,
  };
}
