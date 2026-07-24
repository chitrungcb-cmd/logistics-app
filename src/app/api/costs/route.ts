import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
  isInvoiceCostCategory,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";

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
        paidBy: { select: { id: true, name: true } },
        paidFromCompanyAccount: { select: { id: true, name: true } },
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
    const vendorId = isVendorlessCostCategory(body.category)
      ? null
      : typeof body.vendorId === "string" && body.vendorId
        ? body.vendorId
        : null;
    const vendor = vendorId
      ? await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true } })
      : null;
    if (vendorId && !vendor) return apiError("Nhà cung cấp không hợp lệ.", 400);

    const paidByUserId = typeof body.paidByUserId === "string" && body.paidByUserId ? body.paidByUserId : null;
    if (paidByUserId && !(await prisma.user.findUnique({ where: { id: paidByUserId }, select: { id: true } }))) {
      return apiError("Người chi không hợp lệ.", 400);
    }
    // "Chi từ TK": tài khoản công ty và cá nhân loại trừ nhau — ưu tiên TK công ty nếu gửi cả hai.
    const paidFromCompanyAccountId =
      typeof body.paidFromCompanyAccountId === "string" && body.paidFromCompanyAccountId ? body.paidFromCompanyAccountId : null;
    if (paidFromCompanyAccountId && !(await prisma.companyAccount.findUnique({ where: { id: paidFromCompanyAccountId }, select: { id: true } }))) {
      return apiError("Tài khoản công ty không hợp lệ.", 400);
    }

    const cost = await prisma.$transaction(async (tx) => {
      const created = await tx.shipmentCost.create({
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
          unit: typeof body.unit === "string" ? body.unit.trim() || null : null,
          customLabel: typeof body.customLabel === "string" ? body.customLabel.trim() || null : null,
          note: body.note || null,
          vendorId,
          paidByUserId: paidFromCompanyAccountId ? null : paidByUserId,
          paidFromCompanyAccountId,
        },
        include: {
          shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } },
          vendor: { select: { id: true, name: true, type: true } },
        },
      });
      await tx.costAuditLog.create({
        data: {
          userId: user.id,
          shipmentId: created.shipmentId,
          shipmentCostId: created.id,
          action: "CREATE",
          detail: `Tạo chi phí ${COST_CATEGORY_LABELS[created.category] ?? created.category}: ${created.costPrice.toLocaleString("vi-VN")} đ${isVendorlessCostCategory(created.category) ? "" : vendor ? ` · Nhà cung cấp: ${vendor.name}` : " · Chưa gắn nhà cung cấp"}`,
        },
      });
      if (created.isActual && created.costPrice > 0) {
        await tx.notification.deleteMany({
          where: { type: "COST_MISSING", relatedShipmentId: created.shipmentId },
        });
      }
      await syncShipmentDebts(tx, created.shipmentId);
      return created;
    });

    return apiSuccess(cost, 201);
  } catch (error) {
    console.error("POST /api/costs failed:", error);
    return apiError("Không thể thêm chi phí.", 500);
  }
}
