import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    return apiSuccess({ ok: true });
  } catch (error) {
    console.error("POST /api/notifications/mark-all-read failed:", error);
    return apiError("Không thể đánh dấu đã đọc.", 500);
  }
}
