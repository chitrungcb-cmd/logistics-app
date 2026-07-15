import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { syncMissingActualCostAlerts } from "@/lib/notifications";

const RECENT_LIMIT = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  if (user.role === "ADMIN" || user.role === "ACCOUNTANT") {
    try {
      await syncMissingActualCostAlerts();
    } catch (error) {
      // A reconciliation failure must not hide ordinary task/chat notifications from the bell.
      console.error("Unable to sync missing actual-cost alerts:", error);
    }
  }

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
