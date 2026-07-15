import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSessionCookie, validateNewPassword } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET() {
  const userCount = await prisma.user.count();
  return apiSuccess({ needsSetup: userCount === 0 });
}

function validSetupSecret(received: unknown) {
  const expected = process.env.INITIAL_SETUP_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(expected, "utf8") < 32) return false;
  if (typeof received !== "string") return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

/** Creates the very first ADMIN account. Only works while the User table is empty. */
export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 8 * 1024) return apiError("Yêu cầu quá lớn.", 413);

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return apiError("Hệ thống đã có tài khoản, không thể khởi tạo lại.", 400);
    }

    const body = await request.json();
    const { email, password, name, setupSecret } = body;

    if (!validSetupSecret(setupSecret)) {
      return apiError("Mã khởi tạo quản trị không hợp lệ.", 403);
    }

    if (
      !email || typeof email !== "string" || email.length > 254 ||
      !password || typeof password !== "string" ||
      !name || typeof name !== "string" || name.trim().length > 120
    ) {
      return apiError("Vui lòng nhập đầy đủ họ tên, email và mật khẩu.", 400);
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) return apiError(passwordError, 400);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        passwordHash: await hashPassword(password),
        role: "ADMIN",
      },
    });

    await setSessionCookie(user.id, user.passwordHash);
    return apiSuccess({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  } catch (error) {
    console.error("POST /api/auth/setup failed:", error);
    return apiError("Không thể khởi tạo tài khoản quản trị.", 500);
  }
}
