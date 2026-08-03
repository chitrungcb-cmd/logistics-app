import { getCurrentUser } from "@/lib/auth";
import { getGmailAuthRecord } from "@/lib/google";
import { apiError, apiSuccess } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

// ADMIN-only like the rest of /api/gmail/*. GmailSyncPanel handles the 403 gracefully for other
// roles (it simply never renders), so no UI change is needed.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được dùng đồng bộ Gmail.", 403);

    const [auth, lastDeclaration, lastInvoice] = await Promise.all([
      getGmailAuthRecord(),
      prisma.processedEmail.findFirst({ orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
      prisma.vendorInvoice.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const lastSyncedAt = [lastDeclaration?.processedAt, lastInvoice?.createdAt]
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    return apiSuccess({
      // Merely opening the shipments page must not spend Gmail API quota. The scheduled/manual
      // sync performs the real token check and returns a reconnect instruction for invalid_grant.
      connected: Boolean(auth),
      email: auth?.email ?? null,
      lastSyncedAt,
      serverSyncConfigured: Boolean(process.env.CRON_SECRET),
      reconnectRequired: false,
      connectionError: null,
    });
  } catch (error) {
    console.error("GET /api/gmail/status failed:", error);
    return apiError("Không thể kiểm tra trạng thái kết nối Gmail.", 500);
  }
}
