import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { getGoogleAuthUrl } from "@/lib/google";

// ADMIN-only: connecting a mailbox decides whose email the whole company syncs shipments from.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được kết nối Gmail.", 403);

  return NextResponse.redirect(getGoogleAuthUrl());
}
