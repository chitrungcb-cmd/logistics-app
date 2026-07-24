import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Danh sách TK công ty chỉ là nhãn tài khoản (không kèm số tiền/giá vốn) nên đọc được bởi mọi vai trò
// trừ FIELD_STAFF — ACCOUNTANT cần để chọn "TK nhận tiền" khi ghi nhận thanh toán. Ghi (POST) vẫn ADMIN-only.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem tài khoản công ty.", 403);
  const accounts = await prisma.companyAccount.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  return apiSuccess(accounts);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền thêm tài khoản công ty.", 403);
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("Vui lòng nhập tên tài khoản.", 400);
    const account = await prisma.companyAccount.create({ data: { name } });
    return apiSuccess(account, 201);
  } catch (error) {
    console.error("POST /api/company-accounts failed:", error);
    return apiError("Không thể thêm tài khoản công ty.", 500);
  }
}
