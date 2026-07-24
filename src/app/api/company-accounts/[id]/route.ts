import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Sửa tên / bật-tắt (isActive) tài khoản công ty. Không xóa cứng để không vỡ liên kết chi phí đã gắn.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền sửa tài khoản công ty.", 403);
    const { id } = await params;
    const body = await request.json();
    const data: { name?: string; isActive?: boolean } = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return apiError("Tên tài khoản không hợp lệ.", 400);
      data.name = name;
    }
    if ("isActive" in body) data.isActive = Boolean(body.isActive);
    if (Object.keys(data).length === 0) return apiError("Không có dữ liệu để cập nhật.", 400);
    const account = await prisma.companyAccount.update({ where: { id }, data });
    return apiSuccess(account);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy tài khoản.", 404);
    }
    console.error("PATCH /api/company-accounts/[id] failed:", error);
    return apiError("Không thể cập nhật tài khoản công ty.", 500);
  }
}
