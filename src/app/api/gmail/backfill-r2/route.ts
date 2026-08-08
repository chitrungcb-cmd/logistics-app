import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { backfillLegacyGmailAttachmentsToR2 } from "@/lib/gmail-r2-backfill";
import {
  gmailRetryAfterSeconds,
  isExpiredGmailTokenError,
  isGmailRateLimitError,
} from "@/lib/gmail-errors";
import { getAuthorizedGmailClient, verifyGmailClient } from "@/lib/google";

export const runtime = "nodejs";

let backfillInProgress = false;

function hasValidCronSecret(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!configuredSecret || !authorization?.startsWith("Bearer ")) return false;
  const configured = Buffer.from(configuredSecret, "utf8");
  const provided = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  return configured.length === provided.length && timingSafeEqual(configured, provided);
}

/** Dedicated resumable maintenance endpoint; it never deletes the inaccessible source objects. */
export async function POST(request: NextRequest) {
  let ownsBackfillLock = false;
  try {
    if (!hasValidCronSecret(request)) {
      const user = await getCurrentUser();
      if (!user) return apiError("Chưa đăng nhập.", 401);
      if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được phục hồi tệp cũ.", 403);
    }
    if (backfillInProgress) return apiSuccess({ inProgress: true }, 202);

    const gmail = await getAuthorizedGmailClient();
    if (!gmail) return apiError("Chưa kết nối Gmail.", 400);
    await verifyGmailClient(gmail);

    backfillInProgress = true;
    ownsBackfillLock = true;
    const summary = await backfillLegacyGmailAttachmentsToR2(gmail, 5);
    return apiSuccess(summary);
  } catch (error) {
    if (isExpiredGmailTokenError(error)) {
      return apiError("Phiên Gmail đã hết hạn. Hãy kết nối lại Gmail.", 401);
    }
    if (isGmailRateLimitError(error)) {
      const retryAfterSeconds = gmailRetryAfterSeconds(error) ?? 15 * 60;
      return apiError(
        `Gmail đang giới hạn tần suất. Thử lại sau khoảng ${Math.ceil(retryAfterSeconds / 60)} phút.`,
        429
      );
    }
    console.error("POST /api/gmail/backfill-r2 failed:", error);
    return apiError("Không thể phục hồi tệp Gmail cũ sang R2.", 500);
  } finally {
    if (ownsBackfillLock) backfillInProgress = false;
  }
}
