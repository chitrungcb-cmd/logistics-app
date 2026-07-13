import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import { findSimilarShipments } from "@/lib/similar-shipments";

const SIMILAR_LIMIT = 10;

// Powers "So sánh với lô hàng tương tự" — a category-by-shipment cross-tab of cost totals for the
// current shipment plus its most recent similar ones (see similar-shipments.ts), so an unusually
// high/low line item is easy to spot visually.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem dữ liệu chi phí.", 403);

  const shipmentId = request.nextUrl.searchParams.get("shipmentId");
  if (!shipmentId) return apiError("Thiếu lô hàng.", 400);

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentCode: true,
      customerName: true,
      declarationNo: true,
      declarationDate: true,
      goodsName: true,
    },
  });
  if (!shipment) return apiError("Không tìm thấy lô hàng.", 404);

  const { keyword, shipments: similar } = await findSimilarShipments({
    shipmentId,
    goodsName: shipment.goodsName,
    limit: SIMILAR_LIMIT,
  });

  const columns = [
    {
      id: shipment.id,
      shipmentCode: shipment.shipmentCode,
      customerName: shipment.customerName,
      declarationNo: shipment.declarationNo,
      declarationDate: shipment.declarationDate,
      isCurrent: true,
    },
    ...similar.map((s) => ({
      id: s.id,
      shipmentCode: s.shipmentCode,
      customerName: s.customerName,
      declarationNo: s.declarationNo,
      declarationDate: s.declarationDate,
      isCurrent: false,
    })),
  ];

  const costs = await prisma.shipmentCost.findMany({
    where: { shipmentId: { in: columns.map((c) => c.id) } },
    select: { shipmentId: true, category: true, costPrice: true },
  });

  const rows = COST_CATEGORY_OPTIONS.map((category) => {
    const valuesByShipmentId: Record<string, number> = {};
    for (const col of columns) {
      valuesByShipmentId[col.id] = costs
        .filter((c) => c.shipmentId === col.id && c.category === category)
        .reduce((sum, c) => sum + c.costPrice, 0);
    }
    return { category, valuesByShipmentId };
  });

  return apiSuccess({ keyword, columns, rows });
}
