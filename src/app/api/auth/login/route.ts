import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";

const DUMMY_PASSWORD_HASH = "$2b$12$Tb1Pb.zfsItwIx684812Ru1NifGoiiH625egBGT180SG2ntb6r0p.";

function getClientAddress(request: NextRequest) {
  const direct = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (direct) return direct.trim().slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(0)?.trim();
  return (forwarded || "unknown").slice(0, 64);
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 8 * 1024) return apiError("Yêu cầu quá lớn.", 413);

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || email.length > 254 || password.length > 256) {
      return apiError("Vui lòng nhập email và mật khẩu.", 400);
    }

    // Brute-force throttle: after too many wrong attempts on this email, refuse for a while.
    const clientAddress = getClientAddress(request);
    const retryAfter = loginRetryAfter(email, clientAddress);
    if (retryAfter > 0) {
      return apiError(
        `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(retryAfter / 60)} phút.`,
        429,
        { "Retry-After": String(retryAfter) }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const matches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !matches) {
      recordLoginFailure(email, clientAddress);
      return apiError("Email hoặc mật khẩu không đúng.", 401);
    }
    if (!user.isActive) {
      return apiError("Tài khoản đã bị khóa. Liên hệ quản trị viên.", 403);
    }

    recordLoginSuccess(email, clientAddress);
    await setSessionCookie(user.id, user.passwordHash);
    return apiSuccess({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (error) {
    console.error("POST /api/auth/login failed:", error);
    return apiError("Không thể đăng nhập.", 500);
  }
}
