import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import { getGoodsKeyword } from "@/lib/goods-keyword";
import { applyPresetToExistingShipments } from "@/lib/cost-presets";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền sửa bảng giá.", 403);
    const { id } = await params;
    const body = await request.json();
    const existing = await prisma.costPreset.findUnique({ where: { id } });
    if (!existing) return apiError("Không tìm thấy cấu hình giá.", 404);
    const goodsName = typeof body.goodsName === "string" ? body.goodsName.trim() : existing.goodsName;
    const goodsKeyword = getGoodsKeyword(goodsName);
    if (!goodsKeyword) return apiError("Tên hàng không hợp lệ.", 400);
    const category = body.category ?? existing.category;
    if (!COST_CATEGORY_OPTIONS.includes(category)) return apiError("Hạng mục chi phí không hợp lệ.", 400);
    const unitPrice = body.unitPrice === undefined ? existing.unitPrice : Number(body.unitPrice);
    const quantity = body.quantity === undefined ? existing.quantity : Number(body.quantity);
    const vendorId = body.vendorId === undefined
      ? existing.vendorId
      : typeof body.vendorId === "string" && body.vendorId
        ? body.vendorId
        : null;
    if (vendorId && !(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }))) {
      return apiError("Nhà cung cấp không hợp lệ.", 400);
    }
    const preset = await prisma.costPreset.update({
      where: { id },
      data: { goodsName, goodsKeyword, category, unitPrice, quantity, note: body.note ?? existing.note, vendorId, isActive: body.isActive ?? existing.isActive },
    });
    const matchedShipments = await applyPresetToExistingShipments(preset.id, user.id);
    return apiSuccess({ preset, matchedShipments });
  } catch (error) {
    console.error("PATCH /api/cost-presets/[id] failed:", error);
    return apiError("Không thể cập nhật bảng giá.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xóa bảng giá.", 403);
  const { id } = await params;
  await prisma.costPreset.delete({ where: { id } });
  return apiSuccess({ ok: true });
}
