import { getCurrentUser } from "@/lib/auth";
import {
  getAuthorizedGmailClient,
  getGmailAuthRecord,
  verifyGmailClient,
} from "@/lib/google";
import { isExpiredGmailTokenError } from "@/lib/gmail-errors";
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

    let connected = false;
    let reconnectRequired = false;
    let connectionError: string | null = null;
    if (auth) {
      try {
        const gmail = await getAuthorizedGmailClient();
        if (!gmail) throw new Error("Không tìm thấy cấu hình Gmail.");
        await verifyGmailClient(gmail);
        connected = true;
      } catch (error) {
        reconnectRequired = isExpiredGmailTokenError(error);
        connectionError = reconnectRequired
          ? "Phiên Gmail đã hết hạn hoặc bị Google thu hồi. Hãy kết nối lại Gmail."
          : "Không thể xác thực Gmail lúc này. Hãy thử kết nối lại.";
      }
    }

    return apiSuccess({
      connected,
      email: auth?.email ?? null,
      lastSyncedAt,
      serverSyncConfigured: Boolean(process.env.CRON_SECRET),
      reconnectRequired,
      connectionError,
    });
  } catch (error) {
    console.error("GET /api/gmail/status failed:", error);
    return apiError("Không thể kiểm tra trạng thái kết nối Gmail.", 500);
  }
}
