import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { COST_CATEGORY_OPTIONS, isVendorlessCostCategory } from "@/lib/shipment-cost-constants";
import { getGoodsKeyword } from "@/lib/goods-keyword";
import { applyPresetToExistingShipments, PRESET_EPOCH } from "@/lib/cost-presets";

/** Ngày "áp dụng từ" từ chuỗi yyyy-mm-dd; rỗng = "từ đầu" (PRESET_EPOCH). */
function parseEffectiveFrom(value: unknown): Date | null {
  if (value == null || value === "") return PRESET_EPOCH;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem bảng giá chi phí.", 403);
  return apiSuccess(
    await prisma.costPreset.findMany({
      include: { vendor: { select: { id: true, name: true, type: true } } },
      orderBy: [{ goodsName: "asc" }, { category: "asc" }],
    })
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền thiết lập bảng giá.", 403);
    const body = await request.json();
    const goodsName = typeof body.goodsName === "string" ? body.goodsName.trim() : "";
    const goodsKeyword = getGoodsKeyword(goodsName);
    if (!goodsKeyword) return apiError("Vui lòng nhập tên hàng.", 400);
    if (!COST_CATEGORY_OPTIONS.includes(body.category)) return apiError("Hạng mục chi phí không hợp lệ.", 400);
    const customsGate = typeof body.customsGate === "string" ? body.customsGate.trim() : "";
    const customLabel = typeof body.customLabel === "string" && body.customLabel.trim() ? body.customLabel.trim() : null;
    const effectiveFrom = parseEffectiveFrom(body.effectiveFrom);
    if (!effectiveFrom) return apiError("Ngày áp dụng không hợp lệ.", 400);
    const unitPrice = Number(body.unitPrice);
    const quantity = Number(body.quantity) || 1;
    const vendorId = isVendorlessCostCategory(body.category)
      ? null
      : typeof body.vendorId === "string" && body.vendorId
        ? body.vendorId
        : null;
    if (vendorId && !(await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } }))) {
      return apiError("Nhà cung cấp không hợp lệ.", 400);
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return apiError("Đơn giá không hợp lệ.", 400);

    const preset = await prisma.costPreset.upsert({
      where: { goodsKeyword_customsGate_category_effectiveFrom: { goodsKeyword, customsGate, category: body.category, effectiveFrom } },
      create: { goodsName, goodsKeyword, customsGate, category: body.category, effectiveFrom, unitPrice, quantity, customLabel, note: body.note || null, vendorId },
      update: { goodsName, unitPrice, quantity, customLabel, note: body.note || null, vendorId, isActive: true },
    });
    const matchedShipments = await applyPresetToExistingShipments(preset.id, user.id);
    return apiSuccess({ preset, matchedShipments }, 201);
  } catch (error) {
    console.error("POST /api/cost-presets failed:", error);
    return apiError("Không thể lưu bảng giá chi phí.", 500);
  }
}
