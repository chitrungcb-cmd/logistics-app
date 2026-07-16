import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getApiModules,
  getPageModule,
  hasModuleAccess,
  type AppModule,
} from "@/lib/module-permissions";

const PUBLIC_PATHS = ["/login"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function readSession(request: NextRequest): Promise<{ userId: string } | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), {
      issuer: "nq-logistics",
      audience: "nq-logistics-web",
      algorithms: ["HS256"],
    });
    return typeof payload.userId === "string" ? { userId: payload.userId } : null;
  } catch {
    return null;
  }
}

async function checkModuleAccess(userId: string, modules: readonly AppModule[]) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, modulePermissions: true, isActive: true },
  });
  if (!user?.isActive) return "unauthenticated" as const;
  return modules.some((module) => hasModuleAccess(user, module))
    ? ("allowed" as const)
    : ("forbidden" as const);
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
 * Verifies the session cookie before protected pages are rendered. For paths tied to a business
 * module, it also reads the fresh per-user permission from the database. Server Components and
 * Route Handlers still perform their own authentication and role checks for sensitive operations.
 *
 * Also gates `/uploads/*` (attachments: customs declarations, invoices, receipts) behind a valid
 * session so they're no longer world-readable to anyone who knows/guesses a URL (audit 2.3). Uploads
 * are only ever embedded same-origin (<iframe>/<img>/<a> on our own pages), so a logged-in browser
 * always sends the cookie; an unauthorized upload request gets a plain 401 (NOT a redirect to the
 * /login HTML, which would render as a broken page inside the preview modal's iframe).
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API handlers still perform their own fresh database authentication and role authorization.
  // Proxy adds CSRF protection and the cross-cutting per-module access gate.
  if (pathname.startsWith("/api/")) {
    if (!SAFE_METHODS.has(request.method) && !isTrustedMutation(request)) {
      return NextResponse.json(
        { success: false, error: "Yêu cầu không đúng nguồn." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const requiredModules = getApiModules(pathname, request.method);
    if (requiredModules) {
      const session = await readSession(request);
      // Route Handlers still perform the authoritative authentication check. When the token is
      // valid enough to identify a user, reject a missing module permission before the handler runs.
      if (session) {
        const access = await checkModuleAccess(session.userId, requiredModules);
        if (access !== "allowed") {
          return NextResponse.json(
            {
              success: false,
              error: access === "forbidden"
                ? "Bạn chưa được cấp quyền truy cập mô-đun này."
                : "Phiên đăng nhập không còn hiệu lực.",
            },
            { status: access === "forbidden" ? 403 : 401, headers: { "Cache-Control": "no-store" } }
          );
        }
      }
    }
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const session = await readSession(request);
  if (session) {
    const pageModule = getPageModule(pathname);
    if (pageModule) {
      const access = await checkModuleAccess(session.userId, [pageModule]);
      if (access === "forbidden") {
        return NextResponse.redirect(new URL("/forbidden", request.url));
      }
      if (access === "unauthenticated") {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/uploads")) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
