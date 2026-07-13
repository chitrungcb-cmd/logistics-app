import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createOAuth2Client } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const shipmentsUrl = new URL("/shipments", request.url);

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
