import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];

/**
 * Optimistic check only (per Next.js's own auth guidance): verifies the session cookie's signature
 * so requests with no/invalid cookie never reach a page, but does NOT hit the database — that's what
 * getCurrentUser() in each Server Component/Route Handler is for (fresh role, real authorization).
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Pages only — API routes do their own getCurrentUser() checks where needed (see /api/users,
  // /api/tasks). This matches Next's own recommended default and avoids the proxy blocking
  // server-to-server/background calls (e.g. the Gmail sync trigger) that don't carry a browser cookie.
  // `/uploads` is also excluded: it's static files served straight from `public/`, and redirecting an
  // <iframe src="/uploads/...pdf"> to the /login HTML page (instead of returning 200/401) broke the
  // attachment preview modal — a page-navigation redirect doesn't make sense embedded in an iframe.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|uploads|login).*)"],
};
