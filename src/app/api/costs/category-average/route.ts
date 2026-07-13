import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import { findSimilarShipments } from "@/lib/similar-shipments";

const ANOMALY_LOOKBACK_MONTHS = 6;

// Powers both the per-row price suggestions on the add-cost form (all 9 categories at once, when
// `category` is omitted) and the "⚠ đơn giá cao bất thường" warning — historical average unitPrice
// for the same category, among shipments with a similar goodsName (see similar-shipments.ts) in the
// last 6 months.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem dữ liệu chi phí.", 403);

  const shipmentId = request.nextUrl.searchParams.get("shipmentId");
  const category = request.nextUrl.searchParams.get("category");
  if (!shipmentId) return apiError("Thiếu lô hàng.", 400);
  if (category && !COST_CATEGORY_OPTIONS.includes(category as (typeof COST_CATEGORY_OPTIONS)[number])) {
    return apiError("Loại chi phí không hợp lệ.", 400);
  }

  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { goodsName: true } });
  if (!shipment) return apiError("Không tìm thấy lô hàng.", 404);

  const { keyword, shipments } = await findSimilarShipments({
    shipmentId,
    goodsName: shipment.goodsName,
    monthsBack: ANOMALY_LOOKBACK_MONTHS,
  });

  if (shipments.length === 0) {
    return apiSuccess(
      category
        ? { keyword, average: null, sampleCount: 0 }
        : { keyword, byCategory: emptyByCategory() }
    );
  }

  const costs = await prisma.shipmentCost.findMany({
    where: {
      shipmentId: { in: shipments.map((s) => s.id) },
      ...(category ? { category: category as (typeof COST_CATEGORY_OPTIONS)[number] } : {}),
    },
    select: { category: true, unitPrice: true },
  });

  if (category) {
    if (costs.length === 0) return apiSuccess({ keyword, average: null, sampleCount: 0 });
    const average = costs.reduce((sum, c) => sum + c.unitPrice, 0) / costs.length;
    return apiSuccess({ keyword, average, sampleCount: costs.length });
  }

  const byCategory = emptyByCategory();
  for (const cat of COST_CATEGORY_OPTIONS) {
    const matching = costs.filter((c) => c.category === cat);
    byCategory[cat] =
      matching.length > 0
        ? { average: matching.reduce((sum, c) => sum + c.unitPrice, 0) / matching.length, sampleCount: matching.length }
        : { average: null, sampleCount: 0 };
  }
  return apiSuccess({ keyword, byCategory });
}

function emptyByCategory() {
  return Object.fromEntries(
    COST_CATEGORY_OPTIONS.map((cat) => [cat, { average: null as number | null, sampleCount: 0 }])
  );
}
