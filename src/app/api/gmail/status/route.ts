import { getCurrentUser } from "@/lib/auth";
import { getGmailAuthRecord } from "@/lib/google";
import { apiError, apiSuccess } from "@/lib/api-response";

// ADMIN-only like the rest of /api/gmail/*. GmailSyncPanel handles the 403 gracefully for other
// roles (it simply never renders), so no UI change is needed.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được dùng đồng bộ Gmail.", 403);

    const auth = await getGmailAuthRecord();
    return apiSuccess({ connected: !!auth, email: auth?.email ?? null });
  } catch (error) {
    console.error("GET /api/gmail/status failed:", error);
    return apiError("Không thể kiểm tra trạng thái kết nối Gmail.", 500);
  }
}
