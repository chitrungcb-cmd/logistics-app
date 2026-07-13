import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getCurrentUser } from "@/lib/auth";
import { createOAuth2Client } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const shipmentsUrl = new URL("/shipments", request.url);

  // Google redirects the admin's own browser here, so the session cookie is present on the request.
  // Without this check, anyone could complete an OAuth flow with their own Gmail account and REPLACE
  // the company's connected mailbox (this handler deletes + recreates the single GmailAuth row).
  // Redirect (not JSON 401) because this is a browser navigation, not an XHR call.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user.role !== "ADMIN") {
    shipmentsUrl.searchParams.set("gmail_error", "Chỉ Admin mới được kết nối Gmail.");
    return NextResponse.redirect(shipmentsUrl);
  }

  if (!code) {
    shipmentsUrl.searchParams.set("gmail_error", "Thiếu mã xác thực từ Google.");
    return NextResponse.redirect(shipmentsUrl);
  }

  try {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      shipmentsUrl.searchParams.set(
        "gmail_error",
        "Không nhận được refresh token. Hãy thử kết nối lại (Google chỉ cấp refresh token cho lần cấp quyền đầu tiên)."
      );
      return NextResponse.redirect(shipmentsUrl);
    }

    client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress ?? "unknown";

    await prisma.gmailAuth.deleteMany({});
    await prisma.gmailAuth.create({
      data: { email, refreshToken: tokens.refresh_token },
    });

    shipmentsUrl.searchParams.set("gmail_connected", email);
    return NextResponse.redirect(shipmentsUrl);
  } catch (error) {
    console.error("GET /api/gmail/callback failed:", error);
    shipmentsUrl.searchParams.set("gmail_error", "Kết nối Gmail thất bại.");
    return NextResponse.redirect(shipmentsUrl);
  }
}
