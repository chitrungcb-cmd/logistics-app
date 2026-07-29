import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";
import { COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import { buildCostVarianceReport } from "@/lib/cost-variance-report";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "REPORTS")) return apiError("Bạn không có quyền xem báo cáo này.", 403);

    const params = request.nextUrl.searchParams;
    const category = params.get("category") || "";
    const dateFrom = params.get("dateFrom") || "";
    const dateTo = params.get("dateTo") || "";
    const minVariancePercent = Number(params.get("minVariancePercent") || 30);

    if (category && !COST_CATEGORY_OPTIONS.includes(category as (typeof COST_CATEGORY_OPTIONS)[number])) {
      return apiError("Hạng mục chi phí không hợp lệ.", 400);
    }
    if (!Number.isFinite(minVariancePercent) || minVariancePercent < 0 || minVariancePercent > 1000) {
      return apiError("Mức chênh lệch không hợp lệ.", 400);
    }
    if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) return apiError("Ngày bắt đầu không hợp lệ.", 400);
    if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return apiError("Ngày kết thúc không hợp lệ.", 400);

    const costs = await prisma.shipmentCost.findMany({
      where: {
        isActual: true,
        unitPrice: { gt: 0 },
        quantity: { gt: 0 },
        costPrice: { gt: 0 },
        ...(category ? { category: category as (typeof COST_CATEGORY_OPTIONS)[number] } : {}),
        ...(dateFrom || dateTo
          ? {
              shipment: {
                declarationDate: {
                  ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
                  ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        shipmentId: true,
        category: true,
        customLabel: true,
        unit: true,
        unitPrice: true,
        quantity: true,
        costPrice: true,
        vendor: { select: { name: true } },
        shipment: {
          select: {
            declarationNo: true,
            declarationDate: true,
            customerName: true,
            goodsName: true,
            port: true,
          },
        },
      },
      orderBy: [{ shipment: { declarationDate: "desc" } }, { createdAt: "desc" }],
    });

    const report = buildCostVarianceReport(
      costs.map((cost) => ({
        id: cost.id,
        shipmentId: cost.shipmentId,
        category: cost.category,
        customLabel: cost.customLabel,
        unit: cost.unit,
        unitPrice: cost.unitPrice,
        quantity: cost.quantity,
        costPrice: cost.costPrice,
        vendorName: cost.vendor?.name ?? null,
        declarationNo: cost.shipment.declarationNo,
        declarationDate: cost.shipment.declarationDate,
        customerName: cost.shipment.customerName,
        goodsName: cost.shipment.goodsName,
        port: cost.shipment.port,
      })),
      minVariancePercent
    );

    return apiSuccess({
      ...report,
      filters: { category, dateFrom, dateTo, minVariancePercent },
    });
  } catch (error) {
    console.error("GET /api/reports/cost-variance failed:", error);
    return apiError("Không thể tổng hợp báo cáo chênh lệch chi phí.", 500);
  }
}
