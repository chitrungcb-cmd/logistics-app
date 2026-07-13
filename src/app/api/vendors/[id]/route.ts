import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

const UPDATABLE_FIELDS = ["name", "type", "phone", "address", "taxCode", "note"] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem nhà cung cấp.", 403);

  const { id } = await params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return apiError("Không tìm thấy nhà cung cấp.", 404);
  return apiSuccess(vendor);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa nhà cung cấp.", 403);

    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) data[field] = field === "name" ? body[field] : body[field] || null;
    }

    if (Object.keys(data).length === 0) return apiError("Không có dữ liệu để cập nhật.", 400);

    const vendor = await prisma.vendor.update({ where: { id }, data });
    return apiSuccess(vendor);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy nhà cung cấp.", 404);
    }
    console.error("PATCH /api/vendors/[id] failed:", error);
    return apiError("Không thể cập nhật nhà cung cấp.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xóa nhà cung cấp.", 403);

    const { id } = await params;
    await prisma.vendor.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy nhà cung cấp.", 404);
    }
    console.error("DELETE /api/vendors/[id] failed:", error);
    return apiError("Không thể xóa nhà cung cấp.", 500);
  }
}
