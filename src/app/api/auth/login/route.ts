import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return apiError("Vui lòng nhập email và mật khẩu.", 400);
    }

    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return apiError("Email hoặc mật khẩu không đúng.", 401);
    }

    await setSessionCookie(user.id);
    return apiSuccess({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch (error) {
    console.error("POST /api/auth/login failed:", error);
    return apiError("Không thể đăng nhập.", 500);
  }
}
