import { getGmailAuthRecord } from "@/lib/google";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET() {
  try {
    const auth = await getGmailAuthRecord();
    return apiSuccess({ connected: !!auth, email: auth?.email ?? null });
  } catch (error) {
    console.error("GET /api/gmail/status failed:", error);
    return apiError("Không thể kiểm tra trạng thái kết nối Gmail.", 500);
  }
}
