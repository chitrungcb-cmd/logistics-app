import { getCurrentUser } from "@/lib/auth";
import { apiSuccess } from "@/lib/api-response";

export async function GET() {
  const user = await getCurrentUser();
  return apiSuccess({ user });
}
