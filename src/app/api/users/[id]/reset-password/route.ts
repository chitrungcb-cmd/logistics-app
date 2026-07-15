import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword, validateNewPassword } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// BƯỚC 3 — admin resets an employee's password. The new plaintext is generated/typed in the
// browser and sent here once; the server only ever stores the bcrypt hash and a PasswordResetLog
// row (who reset whom, when). The plaintext is never persisted or returned.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) return apiError("Chưa đăng nhập.", 401);
    if (currentUser.role !== "ADMIN") return apiError("Chỉ Admin mới đặt lại mật khẩu.", 403);

    const { id } = await params;
    const { password } = await request.json();
    const passwordError = validateNewPassword(password);
    if (passwordError) return apiError(passwordError, 400);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) return apiError("Không tìm thấy người dùng.", 404);

    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    await prisma.passwordResetLog.create({
      data: { targetUserId: id, resetByUserId: currentUser.id },
    });

    return apiSuccess({ ok: true });
  } catch (error) {
    console.error("POST /api/users/[id]/reset-password failed:", error);
    return apiError("Không thể đặt lại mật khẩu.", 500);
  }
}
