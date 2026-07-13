import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { computeProfit } from "@/lib/shipment-cost-constants";

// Whole page is ADMIN-only (see CLAUDE.md "Profit visibility") — this endpoint exposes costPrice-
// derived profit, which ACCOUNTANT must never see, so there's no partial/stripped response for them.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem báo cáo lãi lỗ.", 403);

  const shipments = await prisma.shipment.findMany({
    where: { declarationDate: { not: null } },
    select: {
      id: true,
      shipmentCode: true,
      customerName: true,
      declarationNo: true,
      declarationDate: true,
      goodsName: true,
      costs: { select: { costPrice: true, sellPrice: true, isAdditional: true } },
      quotes: { select: { quoteAmount: true, createdAt: true } },
    },
    orderBy: { declarationDate: "desc" },
  });

  const rows = shipments.map((s) => {
    const { totalRevenue, totalCost, profit } = computeProfit(s.costs, s.quotes);
    return {
      id: s.id,
      shipmentCode: s.shipmentCode,
      customerName: s.customerName,
      declarationNo: s.declarationNo,
      declarationDate: s.declarationDate,
      goodsName: s.goodsName,
      totalRevenue,
      totalCost,
      profit,
    };
  });

  return apiSuccess(rows);
}
