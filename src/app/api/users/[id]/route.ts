import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return apiError("Chưa đăng nhập.", 401);
    if (currentUser.role !== "ADMIN") return apiError("Chỉ Admin mới sửa được người dùng.", 403);

    const { id } = await params;
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.name) data.name = body.name;
    if (body.role) {
      if (!["ADMIN", "ACCOUNTANT", "FIELD_STAFF"].includes(body.role)) {
        return apiError("Vai trò không hợp lệ.", 400);
      }
      data.role = body.role;
    }
    if (body.password) {
      if (body.password.length < 8) return apiError("Mật khẩu cần ít nhất 8 ký tự.", 400);
      data.passwordHash = await hashPassword(body.password);
    }

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return apiSuccess(updated);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy người dùng.", 404);
    }
    console.error("PATCH /api/users/[id] failed:", error);
    return apiError("Không thể cập nhật người dùng.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return apiError("Chưa đăng nhập.", 401);
    if (currentUser.role !== "ADMIN") return apiError("Chỉ Admin mới xóa được người dùng.", 403);

    const { id } = await params;
    if (id === currentUser.id) {
      return apiError("Không thể tự xóa tài khoản của chính mình.", 400);
    }

    await prisma.user.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy người dùng.", 404);
    }
    console.error("DELETE /api/users/[id] failed:", error);
    return apiError("Không thể xóa người dùng.", 500);
  }
}
