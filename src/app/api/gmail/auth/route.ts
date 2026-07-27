import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import {
  getGoogleAuthUrl,
  getGoogleRedirectUri,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google";

// ADMIN-only: connecting a mailbox decides whose email the whole company syncs shipments from.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Chỉ Admin mới được kết nối Gmail.", 403);

  const state = randomBytes(32).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(getGoogleAuthUrl(state, getGoogleRedirectUri(request)));
}
