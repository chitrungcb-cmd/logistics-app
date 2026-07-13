import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET() {
  const userCount = await prisma.user.count();
  return apiSuccess({ needsSetup: userCount === 0 });
}

/** Creates the very first ADMIN account. Only works while the User table is empty. */
export async function POST(request: NextRequest) {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return apiError("Hệ thống đã có tài khoản, không thể khởi tạo lại.", 400);
    }

    const body = await request.json();
    const { email, password, name } = body;

    if (!email || typeof email !== "string" || !password || typeof password !== "string" || !name) {
      return apiError("Vui lòng nhập đầy đủ họ tên, email và mật khẩu.", 400);
    }
    if (password.length < 8) {
      return apiError("Mật khẩu cần ít nhất 8 ký tự.", 400);
    }

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name,
        passwordHash: await hashPassword(password),
        role: "ADMIN",
      },
    });

    await setSessionCookie(user.id);
    return apiSuccess({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  } catch (error) {
    console.error("POST /api/auth/setup failed:", error);
    return apiError("Không thể khởi tạo tài khoản quản trị.", 500);
  }
}
