import { prisma } from "@/lib/prisma";
import { getGoodsKeyword } from "@/lib/goods-keyword";
import { COST_CATEGORY_LABELS, isVendorlessCostCategory } from "@/lib/shipment-cost-constants";

export async function applyCostPresetsToShipment(params: {
  shipmentId: string;
  userId: string;
  refreshExisting?: boolean;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    select: { id: true, declarationNo: true, goodsName: true },
  });
  if (!shipment?.declarationNo) return { applied: 0, keyword: null as string | null };

  const keyword = getGoodsKeyword(shipment.goodsName);
  if (!keyword) return { applied: 0, keyword: null as string | null };

  const presets = await prisma.costPreset.findMany({ where: { goodsKeyword: keyword, isActive: true } });
  let applied = 0;
  for (const preset of presets) {
    const vendorId = isVendorlessCostCategory(preset.category) ? null : preset.vendorId;
    const existing = await prisma.shipmentCost.findUnique({
      where: { shipmentId_presetId: { shipmentId: shipment.id, presetId: preset.id } },
    });
    if (existing) {
      // Once a user has confirmed the actual cost, later preset edits must not overwrite it.
      if (params.refreshExisting && !existing.isActual) {
        await prisma.shipmentCost.update({
          where: { id: existing.id },
          data: {
            category: preset.category,
            unitPrice: preset.unitPrice,
            quantity: preset.quantity,
            costPrice: preset.unitPrice * preset.quantity,
            note: preset.note,
            vendorId,
          },
        });
      }
      continue;
    }

    const cost = await prisma.shipmentCost.create({
      data: {
        shipmentId: shipment.id,
        presetId: preset.id,
        category: preset.category,
        unitPrice: preset.unitPrice,
        quantity: preset.quantity,
        costPrice: preset.unitPrice * preset.quantity,
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
    await applyCostPresetsToShipment({ shipmentId: shipment.id, userId, refreshExisting: true });
  }
  return matches.length;
}
