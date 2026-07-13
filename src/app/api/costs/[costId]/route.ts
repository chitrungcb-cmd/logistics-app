import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import { buildUpdateDetail, logCostAudit } from "@/lib/cost-audit-log";

const UPDATABLE_FIELDS = [
  "category",
  "unitPrice",
  "quantity",
  "sellPrice",
  "isAdditional",
  "invoiceNumber",
  "attachmentUrl",
  "note",
] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ costId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền sửa chi phí.", 403);

    const { costId } = await params;
    const existing = await prisma.shipmentCost.findUnique({ where: { id: costId } });
    if (!existing) return apiError("Không tìm thấy khoản chi phí.", 404);

    const body = await request.json();
    if ("category" in body && !COST_CATEGORY_OPTIONS.includes(body.category)) {
      return apiError("Loại chi phí không hợp lệ.", 400);
    }

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    // costPrice is never accepted directly — always re-derived from unitPrice * quantity, using
    // whichever of the two wasn't part of this particular partial update.
    if ("unitPrice" in data || "quantity" in data) {
      const nextUnitPrice = "unitPrice" in data ? Number(data.unitPrice) || 0 : existing.unitPrice;
      const nextQuantity = "quantity" in data ? Number(data.quantity) || 0 : existing.quantity;
      data.unitPrice = nextUnitPrice;
      data.quantity = nextQuantity;
      data.costPrice = nextUnitPrice * nextQuantity;
    }
    if ("sellPrice" in data) data.sellPrice = Number(data.sellPrice) || 0;

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const detail = buildUpdateDetail(existing, data);

    const cost = await prisma.shipmentCost.update({
      where: { id: costId },
      data,
      include: { shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } } },
    });

    await logCostAudit({
      userId: user.id,
      shipmentId: cost.shipmentId,
      shipmentCostId: cost.id,
      action: "UPDATE",
      detail,
    });

    return apiSuccess(cost);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy khoản chi phí.", 404);
    }
    console.error("PATCH /api/costs/[costId] failed:", error);
    return apiError("Không thể cập nhật chi phí.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ costId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền xóa chi phí.", 403);

    const { costId } = await params;
    const existing = await prisma.shipmentCost.findUnique({ where: { id: costId } });
    if (!existing) return apiError("Không tìm thấy khoản chi phí.", 404);

    await prisma.shipmentCost.delete({ where: { id: costId } });

    // shipmentCostId: null — the row is gone by the time this log is read, so there's nothing left
    // to reference (the FK's own ON DELETE SET NULL only handles logs created *before* this delete).
    await logCostAudit({
      userId: user.id,
      shipmentId: existing.shipmentId,
      shipmentCostId: null,
      action: "DELETE",
      detail: `Xóa chi phí ${COST_CATEGORY_LABELS[existing.category] ?? existing.category}: ${existing.costPrice.toLocaleString("vi-VN")} đ`,
    });

    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy khoản chi phí.", 404);
    }
    console.error("DELETE /api/costs/[costId] failed:", error);
    return apiError("Không thể xóa chi phí.", 500);
  }
}
