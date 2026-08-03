import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";
import { google } from "googleapis";
import { getCurrentUser } from "@/lib/auth";
import { createOAuth2Client, getGoogleRedirectUri } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google";
import { encryptSecret } from "@/lib/secret-encryption";

function statesMatch(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  // Hostinger forwards the public request to Next.js through an internal 0.0.0.0 listener. Using
  // request.url for the browser redirect would therefore send the admin to
  // https://0.0.0.0:3000/shipments after Google finishes OAuth. The already-resolved Google
  // callback URL has the trusted public origin (APP_URL / GOOGLE_REDIRECT_URI / forwarded host),
  // so reuse that origin for every browser redirect from this handler.
  const googleRedirectUri = getGoogleRedirectUri(request);
  const publicOrigin = new URL(googleRedirectUri).origin;
  const shipmentsUrl = new URL("/shipments", publicOrigin);
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // Google redirects the admin's own browser here, so the session cookie is present on the request.
  // Without this check, anyone could complete an OAuth flow with their own Gmail account and REPLACE
  // the company's connected mailbox (this handler deletes + recreates the single GmailAuth row).
  // Redirect (not JSON 401) because this is a browser navigation, not an XHR call.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", publicOrigin));
  }
  if (user.role !== "ADMIN") {
    shipmentsUrl.searchParams.set("gmail_error", "Chỉ Admin mới được kết nối Gmail.");
    return NextResponse.redirect(shipmentsUrl);
  }

  if (!statesMatch(state, expectedState)) {
    shipmentsUrl.searchParams.set("gmail_error", "Phiên kết nối Gmail không hợp lệ hoặc đã hết hạn.");
    return NextResponse.redirect(shipmentsUrl);
  }

  if (!code) {
    shipmentsUrl.searchParams.set("gmail_error", "Thiếu mã xác thực từ Google.");
    return NextResponse.redirect(shipmentsUrl);
  }

  try {
    const client = createOAuth2Client(googleRedirectUri);
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
      data: { email, refreshToken: encryptSecret(tokens.refresh_token) },
    });

    shipmentsUrl.searchParams.set("gmail_connected", email);
    return NextResponse.redirect(shipmentsUrl);
  } catch (error) {
    console.error("GET /api/gmail/callback failed:", error);
    shipmentsUrl.searchParams.set("gmail_error", "Kết nối Gmail thất bại.");
    return NextResponse.redirect(shipmentsUrl);
  }
}
