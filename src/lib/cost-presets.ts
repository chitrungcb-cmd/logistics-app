import { prisma } from "@/lib/prisma";
import { getGoodsKeyword, getGoodsQuantity, isPerLotUnit, presetGateMatchesPort } from "@/lib/goods-keyword";
import { COST_CATEGORY_LABELS, isVendorlessCostCategory } from "@/lib/shipment-cost-constants";
import type { CostCategory } from "@/generated/prisma/enums";

/** Mốc "từ đầu" — giá không đặt ngày áp dụng cụ thể. */
export const PRESET_EPOCH = new Date("1970-01-01T00:00:00.000Z");

/**
 * Chọn bộ giá áp cho một lô: mỗi hạng mục chỉ MỘT bộ, theo thứ tự ưu tiên:
 *  1. Cửa khẩu khớp `port` của lô — bộ cửa khẩu cụ thể thắng bộ "mọi cửa khẩu" ("").
 *  2. Chỉ xét mốc đã tới (`effectiveFrom` <= ngày tờ khai); trong cùng mức cửa khẩu, mốc MỚI hơn thắng.
 * Nhờ vậy mỗi cửa khẩu × mặt hàng × thời điểm đều áp đúng giá, không xung đột.
 */
export function selectApplicablePresets<T extends { category: CostCategory; customsGate: string; effectiveFrom: Date }>(
  presets: T[],
  port: string | null | undefined,
  declarationDate: Date | null | undefined
): T[] {
  const asOf = (declarationDate ?? new Date()).getTime();
  const byCategory = new Map<CostCategory, T>();
  for (const preset of presets) {
    if (!presetGateMatchesPort(preset.customsGate, port)) continue;
    if (preset.effectiveFrom.getTime() > asOf) continue; // mốc chưa tới ngày tờ khai
    const current = byCategory.get(preset.category);
    if (!current) {
      byCategory.set(preset.category, preset);
      continue;
    }
    const presetSpecific = preset.customsGate.trim() !== "";
    const currentSpecific = current.customsGate.trim() !== "";
    const better =
      presetSpecific !== currentSpecific
        ? presetSpecific
        : preset.effectiveFrom.getTime() > current.effectiveFrom.getTime();
    if (better) byCategory.set(preset.category, preset);
  }
  return [...byCategory.values()];
}

type CostIdentity = {
  category: CostCategory;
  customLabel: string | null;
};

type ExistingShipmentCostIdentity = CostIdentity & {
  presetId: string | null;
};

function normalizeCostLabel(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

/**
 * Hạng mục chuẩn chỉ được có một dòng trong một lô. Riêng "Khác" có thể chứa nhiều khoản khác
 * nhau nên dùng thêm tên hiển thị để phân biệt (vd. "Lái xe chuyên trách" và "Nâng hạ").
 */
export function shipmentCostIdentityKey(cost: CostIdentity) {
  if (cost.category !== "KHAC") return cost.category;
  return `${cost.category}:${normalizeCostLabel(cost.customLabel)}`;
}

/**
 * Chỉ lấy các dòng bảng giá còn thiếu trên lô hàng. Dòng đã nhập tay, dòng từ phiên bản bảng giá
 * cũ và dòng đã xác nhận thực tế đều được giữ nguyên, tuyệt đối không dùng bảng giá ghi đè.
 */
export function selectMissingCostPresets<
  T extends CostIdentity & { id: string },
>(presets: T[], existingCosts: ExistingShipmentCostIdentity[]): T[] {
  const existingPresetIds = new Set(
    existingCosts.flatMap((cost) => (cost.presetId ? [cost.presetId] : []))
  );
  const existingKeys = new Set(existingCosts.map(shipmentCostIdentityKey));

  return presets.filter((preset) => {
    if (existingPresetIds.has(preset.id)) return false;
    const key = shipmentCostIdentityKey(preset);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
}

export async function applyCostPresetsToShipment(params: {
  shipmentId: string;
  userId: string;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    select: { id: true, declarationNo: true, declarationDate: true, goodsName: true, port: true },
  });
  if (!shipment?.declarationNo) return { applied: 0, keyword: null as string | null };

  const keyword = getGoodsKeyword(shipment.goodsName);
  if (!keyword) return { applied: 0, keyword: null as string | null };

  const allPresets = await prisma.costPreset.findMany({ where: { goodsKeyword: keyword, isActive: true } });
  const applicablePresets = selectApplicablePresets(allPresets, shipment.port, shipment.declarationDate);
  const existingCosts = await prisma.shipmentCost.findMany({
    where: { shipmentId: shipment.id },
    select: { presetId: true, category: true, customLabel: true },
  });
  const presets = selectMissingCostPresets(applicablePresets, existingCosts);
  let applied = 0;
  for (const preset of presets) {
    const vendorId = isVendorlessCostCategory(preset.category) ? null : preset.vendorId;
    // Số lượng: đơn vị "cho cả lô" (Lô/để trống) giữ số lượng cấu hình; đơn vị theo món (máy, xe...)
    // nhân theo số lượng suy từ tên hàng (vd "10 MÁY NGHIỀN" → 10).
    const quantity = isPerLotUnit(preset.unit) ? preset.quantity : getGoodsQuantity(shipment.goodsName);
    const costPrice = preset.unitPrice * quantity;
    const cost = await prisma.shipmentCost.create({
      data: {
        shipmentId: shipment.id,
        presetId: preset.id,
        category: preset.category,
        unitPrice: preset.unitPrice,
        quantity,
        costPrice,
        customLabel: preset.customLabel,
        unit: preset.unit,
        paidByUserId: preset.paidByUserId,
        paidFromCompanyAccountId: preset.paidFromCompanyAccountId,
        note: preset.note,
        vendorId,
        isActual: false,
      },
    });
    await prisma.costAuditLog.create({
      data: {
        userId: params.userId,
        shipmentId: shipment.id,
        shipmentCostId: cost.id,
        action: "CREATE",
        detail: `Tạo chi phí dự kiến từ bảng giá ${COST_CATEGORY_LABELS[preset.category]}: ${cost.costPrice.toLocaleString("vi-VN")} đ`,
      },
    });
    applied += 1;
  }
  return { applied, keyword };
}

export async function applyPresetToExistingShipments(presetId: string, userId: string) {
  const preset = await prisma.costPreset.findUnique({ where: { id: presetId } });
  if (!preset) return 0;
  const shipments = await prisma.shipment.findMany({
    where: { declarationNo: { not: null }, goodsName: { not: null } },
    select: { id: true, goodsName: true },
  });
  const matches = shipments.filter((shipment) => getGoodsKeyword(shipment.goodsName) === preset.goodsKeyword);
  for (const shipment of matches) {
    await applyCostPresetsToShipment({ shipmentId: shipment.id, userId });
  }
  return matches.length;
}
