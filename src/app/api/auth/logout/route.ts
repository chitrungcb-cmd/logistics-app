import { clearSessionCookie } from "@/lib/auth";
import { apiSuccess } from "@/lib/api-response";

export async function POST() {
  await clearSessionCookie();
  return apiSuccess({ ok: true });
}
