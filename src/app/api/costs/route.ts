import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  isInvoiceCostCategory,
} from "@/lib/shipment-cost-constants";
import { logCostAudit } from "@/lib/cost-audit-log";

// Flat ledger across every shipment — ADMIN only, end to end (see CLAUDE.md "Profit visibility").
// This is the ONLY place ShipmentCost is created/edited/deleted in the whole app; the shipment
// detail page deliberately shows nothing but a link here for ADMIN, to avoid a second surface that
// needs its own permission checks.
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem chi phí.", 403);

    const params = request.nextUrl.searchParams;
    const shipmentId = params.get("shipmentId");
    const category = params.get("category");
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const additionalOnly = params.get("additionalOnly") === "true";
    const customerSearch = params.get("customer")?.trim();

    const costs = await prisma.shipmentCost.findMany({
      where: {
        ...(shipmentId ? { shipmentId } : {}),
        ...(category ? { category: category as (typeof COST_CATEGORY_OPTIONS)[number] } : {}),
        ...(additionalOnly ? { isAdditional: true } : {}),
        ...(dateFrom || dateTo
          ? {
              createdAt: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59`) } : {}),
              },
            }
          : {}),
        ...(customerSearch
          ? { shipment: { customerName: { contains: customerSearch, mode: "insensitive" } } }
          : {}),
      },
      include: {
        shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } },
        vendor: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return apiSuccess(costs);
  } catch (error) {
    console.error("GET /api/costs failed:", error);
    return apiError("Không thể tải danh sách chi phí.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền thêm chi phí.", 403);

    const body = await request.json();
    if (!body.shipmentId) return apiError("Vui lòng chọn lô hàng.", 400);
    if (!body.category || !COST_CATEGORY_OPTIONS.includes(body.category)) {
      return apiError("Vui lòng chọn loại chi phí hợp lệ.", 400);
    }

    const unitPrice = Number(body.unitPrice) || 0;
    const quantity = Number(body.quantity) || 1;
    const vendorId = typeof body.vendorId === "string" && body.vendorId ? body.vendorId : null;
    const vendor = vendorId
      ? await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } })
      : null;
    if (vendorId && !vendor) return apiError("Nhà cung cấp không hợp lệ.", 400);

    const cost = await prisma.shipmentCost.create({
      data: {
        shipmentId: body.shipmentId,
        category: body.category,
        unitPrice,
        quantity,
        costPrice: unitPrice * quantity,
        sellPrice: Number(body.sellPrice) || 0,
        isAdditional: !!body.isAdditional,
        isActual: true,
        invoiceNumber: isInvoiceCostCategory(body.category) ? body.invoiceNumber || null : null,
        attachmentUrl: body.attachmentUrl || null,
        note: body.note || null,
        vendorId,
      },
      include: {
        shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } },
        vendor: { select: { id: true, name: true, type: true } },
      },
    });

    await logCostAudit({
      userId: user.id,
      shipmentId: cost.shipmentId,
      shipmentCostId: cost.id,
      action: "CREATE",
      detail: `Tạo chi phí ${COST_CATEGORY_LABELS[cost.category] ?? cost.category}: ${cost.costPrice.toLocaleString("vi-VN")} đ${vendor ? ` · Nhà cung cấp: ${vendor.name}` : " · Chưa gắn nhà cung cấp"}`,
    });

    return apiSuccess(cost, 201);
  } catch (error) {
    console.error("POST /api/costs failed:", error);
    return apiError("Không thể thêm chi phí.", 500);
  }
}
