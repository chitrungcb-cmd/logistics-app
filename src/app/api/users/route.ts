import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, hashPassword, validateNewPassword } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { addUserToCompanyConversation } from "@/lib/chat";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  // ACCOUNTANT also needs the user list to assign tasks — only FIELD_STAFF is excluded.
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem danh sách người dùng.", 403);

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return apiSuccess(users);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Chỉ Admin mới tạo được người dùng.", 403);

    const { email, password, name, role } = await request.json();
    if (!email || !password || !name || !role) {
      return apiError("Vui lòng nhập đầy đủ họ tên, email, mật khẩu và vai trò.", 400);
    }
    if (!["ADMIN", "ACCOUNTANT", "FIELD_STAFF"].includes(role)) {
      return apiError("Vai trò không hợp lệ.", 400);
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) return apiError(passwordError, 400);

    const created = await prisma.user.create({
      data: {
        email: String(email).toLowerCase().trim(),
        name,
        role,
        passwordHash: await hashPassword(password),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });

    await addUserToCompanyConversation(created.id);

    return apiSuccess(created, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Email này đã được sử dụng.", 409);
    }
    console.error("POST /api/users failed:", error);
    return apiError("Không thể tạo người dùng.", 500);
  }
}
