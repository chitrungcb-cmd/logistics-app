import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_OPTIONS, isVendorlessCostCategory } from "@/lib/shipment-cost-constants";
import { getGoodsKeyword } from "@/lib/goods-keyword";
import { applyPresetToExistingShipments, PRESET_EPOCH } from "@/lib/cost-presets";

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
    const customsGate = typeof body.customsGate === "string" ? body.customsGate.trim() : existing.customsGate;
    const customLabel = body.customLabel === undefined
      ? existing.customLabel
      : typeof body.customLabel === "string" && body.customLabel.trim() ? body.customLabel.trim() : null;
    let effectiveFrom = existing.effectiveFrom;
    if (body.effectiveFrom !== undefined) {
      if (body.effectiveFrom === "" || body.effectiveFrom === null) {
        effectiveFrom = PRESET_EPOCH;
      } else if (typeof body.effectiveFrom === "string" && /^\d{4}-\d{2}-\d{2}/.test(body.effectiveFrom)) {
        const parsed = new Date(`${body.effectiveFrom.slice(0, 10)}T00:00:00.000Z`);
        if (Number.isNaN(parsed.getTime())) return apiError("Ngày áp dụng không hợp lệ.", 400);
        effectiveFrom = parsed;
      } else {
        return apiError("Ngày áp dụng không hợp lệ.", 400);
      }
    }
    const unitPrice = body.unitPrice === undefined ? existing.unitPrice : Number(body.unitPrice);
    const quantity = body.quantity === undefined ? existing.quantity : Number(body.quantity);
    const vendorId = isVendorlessCostCategory(category)
      ? null
      : body.vendorId === undefined
        ? existing.vendorId
        : typeof body.vendorId === "string" && body.vendorId
          ? body.vendorId
          : null;
    if (vendorId && !(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }))) {
      return apiError("Nhà cung cấp không hợp lệ.", 400);
    }
    const unit = body.unit === undefined ? existing.unit : (typeof body.unit === "string" && body.unit.trim() ? body.unit.trim() : null);
    const paidFromCompanyAccountId = body.paidFromCompanyAccountId === undefined
      ? existing.paidFromCompanyAccountId
      : (typeof body.paidFromCompanyAccountId === "string" && body.paidFromCompanyAccountId ? body.paidFromCompanyAccountId : null);
    const paidByUserId = paidFromCompanyAccountId
      ? null
      : body.paidByUserId === undefined
        ? existing.paidByUserId
        : (typeof body.paidByUserId === "string" && body.paidByUserId ? body.paidByUserId : null);

    const preset = await prisma.costPreset.update({
      where: { id },
      data: { goodsName, goodsKeyword, customsGate, category, effectiveFrom, unitPrice, quantity, customLabel, unit, paidByUserId, paidFromCompanyAccountId, note: body.note ?? existing.note, vendorId, isActive: body.isActive ?? existing.isActive },
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
