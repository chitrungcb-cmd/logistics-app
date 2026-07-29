import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";
import { getGoodsKeyword } from "@/lib/goods-keyword";
import { buildCopiedCostData, costCopySignature } from "@/lib/cost-copy";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";

const sourceCostInclude = {
  vendor: { select: { id: true, name: true, type: true } },
  paidBy: { select: { id: true, name: true } },
  paidFromCompanyAccount: { select: { id: true, name: true } },
} as const;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "COSTS")) return apiError("Bạn không có quyền xem chi phí.", 403);

    const targetShipmentId = request.nextUrl.searchParams.get("targetShipmentId");
    const scope = request.nextUrl.searchParams.get("scope") ?? "customer";
    if (!targetShipmentId) return apiError("Thiếu lô hàng cần nhận chi phí.", 400);
    if (!["customer", "goods", "all"].includes(scope)) return apiError("Phạm vi sao chép không hợp lệ.", 400);

    const target = await prisma.shipment.findUnique({
      where: { id: targetShipmentId },
      select: {
        id: true,
        customerId: true,
        customerName: true,
        goodsName: true,
        costs: {
          select: {
            category: true,
            customLabel: true,
            vendorId: true,
            unitPrice: true,
            quantity: true,
            unit: true,
            paidByUserId: true,
            paidFromCompanyAccountId: true,
          },
        },
      },
    });
    if (!target) return apiError("Không tìm thấy lô hàng cần nhận chi phí.", 404);

    const targetGoodsKeyword = getGoodsKeyword(target.goodsName);
    if (scope === "goods" && !targetGoodsKeyword) {
      return apiSuccess({ target, scope, sources: [], message: "Lô này chưa có tên hàng để tìm cùng nhóm." });
    }

    const baseWhere = {
      id: { not: target.id },
      costs: { some: { costPrice: { gt: 0 } } },
    };
    const customerWhere = target.customerId
      ? { customerId: target.customerId }
      : { customerName: { equals: target.customerName, mode: "insensitive" as const } };
    const candidates = await prisma.shipment.findMany({
      where: {
        ...baseWhere,
        ...(scope === "customer" ? customerWhere : {}),
      },
      select: {
        id: true,
        customerName: true,
        declarationNo: true,
        declarationDate: true,
        goodsName: true,
        createdAt: true,
        costs: {
          where: { costPrice: { gt: 0 } },
          include: sourceCostInclude,
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ declarationDate: "desc" }, { createdAt: "desc" }],
      take: scope === "goods" ? 200 : 80,
    });

    const targetSignatures = new Set(target.costs.map(costCopySignature));
    const sources = candidates
      .filter((shipment) => scope !== "goods" || getGoodsKeyword(shipment.goodsName) === targetGoodsKeyword)
      .slice(0, 80)
      .map((shipment) => ({
        ...shipment,
        totalCost: shipment.costs.reduce((sum, cost) => sum + cost.costPrice, 0),
        costs: shipment.costs.map((cost) => ({
          ...cost,
          alreadyExists: targetSignatures.has(costCopySignature(cost)),
        })),
      }));

    return apiSuccess({ target, scope, sources });
  } catch (error) {
    console.error("GET /api/costs/copy failed:", error);
    return apiError("Không thể tải danh sách lô để sao chép.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "COSTS")) return apiError("Bạn không có quyền thêm chi phí.", 403);

    const body = await request.json();
    const targetShipmentId = typeof body.targetShipmentId === "string" ? body.targetShipmentId : "";
    const sourceShipmentId = typeof body.sourceShipmentId === "string" ? body.sourceShipmentId : "";
    const rawCostIds: unknown[] = Array.isArray(body.costIds) ? body.costIds : [];
    const costIds = [
      ...new Set(rawCostIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
    ];
    if (!targetShipmentId || !sourceShipmentId || costIds.length === 0) {
      return apiError("Vui lòng chọn lô nguồn và ít nhất một khoản chi phí.", 400);
    }
    if (targetShipmentId === sourceShipmentId) return apiError("Không thể sao chép chi phí vào chính lô nguồn.", 400);
    if (costIds.length > 100) return apiError("Mỗi lần chỉ được sao chép tối đa 100 khoản.", 400);

    const [target, source] = await Promise.all([
      prisma.shipment.findUnique({
        where: { id: targetShipmentId },
        select: {
          id: true,
          declarationNo: true,
          costs: {
            select: {
              category: true,
              customLabel: true,
              vendorId: true,
              unitPrice: true,
              quantity: true,
              unit: true,
              paidByUserId: true,
              paidFromCompanyAccountId: true,
            },
          },
        },
      }),
      prisma.shipment.findUnique({
        where: { id: sourceShipmentId },
        select: {
          id: true,
          declarationNo: true,
          costs: {
            where: { id: { in: costIds }, costPrice: { gt: 0 } },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    ]);
    if (!target) return apiError("Không tìm thấy lô nhận chi phí.", 404);
    if (!source) return apiError("Không tìm thấy lô nguồn.", 404);
    if (source.costs.length === 0) return apiError("Không tìm thấy khoản chi phí đã chọn.", 404);

    const result = await prisma.$transaction(async (tx) => {
      const signatures = new Set(target.costs.map(costCopySignature));
      let skipped = costIds.length - source.costs.length;
      const created = [];

      for (const sourceCost of source.costs) {
        const signature = costCopySignature(sourceCost);
        if (signatures.has(signature)) {
          skipped += 1;
          continue;
        }
        signatures.add(signature);
        const copied = await tx.shipmentCost.create({
          data: buildCopiedCostData(sourceCost, target.id),
          include: {
            shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } },
            vendor: { select: { id: true, name: true, type: true } },
            paidBy: { select: { id: true, name: true } },
            paidFromCompanyAccount: { select: { id: true, name: true } },
          },
        });
        await tx.costAuditLog.create({
          data: {
            userId: user.id,
            shipmentId: target.id,
            shipmentCostId: copied.id,
            action: "CREATE",
            detail: `Sao chép chi phí ${COST_CATEGORY_LABELS[copied.category] ?? copied.category} từ TK ${source.declarationNo || "chưa có số"}: ${copied.costPrice.toLocaleString("vi-VN")} đ`,
          },
        });
        created.push(copied);
      }

      if (created.length > 0) {
        await tx.notification.deleteMany({
          where: { type: "COST_MISSING", relatedShipmentId: target.id },
        });
        await syncShipmentDebts(tx, target.id);
      }
      return { created, skipped };
    });

    return apiSuccess({
      ...result,
      message:
        result.created.length > 0
          ? `Đã sao chép ${result.created.length} khoản; bỏ qua ${result.skipped} khoản trùng.`
          : `Không có khoản mới để sao chép; đã bỏ qua ${result.skipped} khoản trùng.`,
    });
  } catch (error) {
    console.error("POST /api/costs/copy failed:", error);
    return apiError("Không thể sao chép chi phí.", 500);
  }
}
