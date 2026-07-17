import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

const RECENT_LIMIT = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    prisma.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  return apiSuccess({ notifications, unreadCount });
}
