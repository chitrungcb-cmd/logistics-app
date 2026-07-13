import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) return apiError("Không tìm thấy thông báo.", 404);
    if (existing.userId !== user.id) return apiError("Bạn không có quyền sửa thông báo này.", 403);

    const body = await request.json();
    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: body.isRead ?? true },
    });
    return apiSuccess(notification);
  } catch (error) {
    console.error("PATCH /api/notifications/[id] failed:", error);
    return apiError("Không thể cập nhật thông báo.", 500);
  }
}
