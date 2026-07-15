import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function hasValidSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), {
      issuer: "nq-logistics",
      audience: "nq-logistics-web",
      algorithms: ["HS256"],
    });
    return true;
  } catch {
    return false;
  }
}

function isTrustedMutation(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true; // server-to-server jobs do not normally send Origin

  const allowedOrigins = new Set<string>([request.nextUrl.origin]);
  const configuredOrigin = process.env.APP_URL;
  if (configuredOrigin) {
    try {
      allowedOrigins.add(new URL(configuredOrigin).origin);
    } catch {
      // Deployment validation reports an invalid APP_URL; do not trust it here.
    }
  }
  return allowedOrigins.has(origin);
}

/**
 * Optimistic check only (per Next.js's own auth guidance): verifies the session cookie's signature
 * so requests with no/invalid cookie never reach a page, but does NOT hit the database — that's what
 * getCurrentUser() in each Server Component/Route Handler is for (fresh role, real authorization).
 *
 * Also gates `/uploads/*` (attachments: customs declarations, invoices, receipts) behind a valid
 * session so they're no longer world-readable to anyone who knows/guesses a URL (audit 2.3). Uploads
 * are only ever embedded same-origin (<iframe>/<img>/<a> on our own pages), so a logged-in browser
 * always sends the cookie; an unauthorized upload request gets a plain 401 (NOT a redirect to the
 * /login HTML, which would render as a broken page inside the preview modal's iframe).
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API handlers still perform their own fresh database authorization. Proxy only rejects
  // cross-site state-changing browser requests before they can reach those handlers.
  if (pathname.startsWith("/api/")) {
    if (!SAFE_METHODS.has(request.method) && !isTrustedMutation(request)) {
      return NextResponse.json(
        { success: false, error: "Yêu cầu không đúng nguồn." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (await hasValidSession(request)) return NextResponse.next();

  if (pathname.startsWith("/uploads")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
