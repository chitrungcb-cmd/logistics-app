import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";

const UPDATABLE_FIELDS = ["quoteAmount", "quoteDate", "attachmentUrl", "note"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa báo giá.", 403);

    const { quoteId } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }
    if ("quoteAmount" in data) data.quoteAmount = Number(data.quoteAmount) || 0;
    if ("quoteDate" in data && data.quoteDate) data.quoteDate = new Date(data.quoteDate as string);

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const quote = await prisma.$transaction(async (tx) => {
      const updated = await tx.quote.update({ where: { id: quoteId }, data });
      await syncShipmentDebts(tx, updated.shipmentId);
      return updated;
    });
    return apiSuccess(quote);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy báo giá.", 404);
    }
    console.error("PATCH /api/shipments/[id]/quotes/[quoteId] failed:", error);
    return apiError("Không thể cập nhật báo giá.", 500);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xóa báo giá.", 403);

    const { quoteId } = await params;
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.quote.delete({ where: { id: quoteId } });
      await syncShipmentDebts(tx, deleted.shipmentId);
    });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy báo giá.", 404);
    }
    console.error("DELETE /api/shipments/[id]/quotes/[quoteId] failed:", error);
    return apiError("Không thể xóa báo giá.", 500);
  }
}
