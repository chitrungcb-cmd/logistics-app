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
import { buildUpdateDetail } from "@/lib/cost-audit-log";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";

const UPDATABLE_FIELDS = [
  "category",
  "unitPrice",
  "quantity",
  "sellPrice",
  "isAdditional",
  "invoiceNumber",
  "attachmentUrl",
  "note",
  "vendorId",
  "isActual",
] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ costId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền sửa chi phí.", 403);

    const { costId } = await params;
    const existing = await prisma.shipmentCost.findUnique({
      where: { id: costId },
      include: { vendor: { select: { id: true, name: true } } },
    });
    if (!existing) return apiError("Không tìm thấy khoản chi phí.", 404);

    const body = await request.json();
    if ("category" in body && !COST_CATEGORY_OPTIONS.includes(body.category)) {
      return apiError("Loại chi phí không hợp lệ.", 400);
    }

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    const nextCategory = typeof data.category === "string" ? data.category : existing.category;
    let nextVendorName = existing.vendor?.name ?? null;
    if (isVendorlessCostCategory(nextCategory)) {
      data.vendorId = null;
      nextVendorName = null;
    } else if ("vendorId" in data) {
      data.vendorId = typeof data.vendorId === "string" && data.vendorId ? data.vendorId : null;
      if (data.vendorId) {
        const vendor = await prisma.vendor.findUnique({
          where: { id: data.vendorId as string },
          select: { name: true },
        });
        if (!vendor) return apiError("Nhà cung cấp không hợp lệ.", 400);
        nextVendorName = vendor.name;
      } else {
        nextVendorName = null;
      }
    }

    // Chỉ Kiểm dịch, Hạ tầng, Sang tải, Bến bãi và Vận tải được phép mang số hóa đơn.
    if ("category" in data || "invoiceNumber" in data) {
      if (!isInvoiceCostCategory(nextCategory)) data.invoiceNumber = null;
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

    // Any user-initiated edit confirms a preset estimate as an actual cost. The client may also
    // explicitly send isActual=true when the configured amount already matches the real expense.
    if (existing.presetId && !existing.isActual) data.isActual = true;

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const detail = buildUpdateDetail(existing, data, {
      previous: existing.vendor?.name ?? null,
      next: nextVendorName,
    });

    // The edit and its audit entry must either both succeed or both roll back. This guarantees that
    // every manual change to a confirmed cost always has an accountable history record.
    const cost = await prisma.$transaction(async (tx) => {
      const updated = await tx.shipmentCost.update({
        where: { id: costId },
        data,
        include: {
          shipment: { select: { id: true, shipmentCode: true, customerName: true, goodsName: true, declarationNo: true, declarationDate: true, invoiceNo: true } },
          vendor: { select: { id: true, name: true, type: true } },
        },
      });
      await tx.costAuditLog.create({
        data: {
          userId: user.id,
          shipmentId: updated.shipmentId,
          shipmentCostId: updated.id,
          action: "UPDATE",
          detail,
        },
      });
      if (updated.isActual && updated.costPrice > 0) {
        await tx.notification.deleteMany({
          where: { type: "COST_MISSING", relatedShipmentId: updated.shipmentId },
        });
      }
      await syncShipmentDebts(tx, updated.shipmentId);
      return updated;
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

    await prisma.$transaction(async (tx) => {
      await tx.shipmentCost.delete({ where: { id: costId } });
      // shipmentCostId để null vì dòng chi phí đã bị xóa nhưng lịch sử vẫn phải được giữ lại.
      await tx.costAuditLog.create({
        data: {
          userId: user.id,
          shipmentId: existing.shipmentId,
          shipmentCostId: null,
          action: "DELETE",
          detail: `Xóa chi phí ${COST_CATEGORY_LABELS[existing.category] ?? existing.category}: ${existing.costPrice.toLocaleString("vi-VN")} đ`,
        },
      });
      await syncShipmentDebts(tx, existing.shipmentId);
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
