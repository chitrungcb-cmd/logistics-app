import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const search = request.nextUrl.searchParams.get("search")?.trim();

  const customers = await prisma.customer.findMany({
    where: search
      ? {
          OR: [
            { companyName: { contains: search, mode: "insensitive" } },
            { taxCode: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { companyName: "asc" },
  });
  return apiSuccess(customers);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") {
      return apiError("Bạn không có quyền thêm khách hàng.", 403);
    }

    const body = await request.json();
    if (!body.companyName || !body.taxCode) {
      return apiError("Vui lòng nhập tên công ty và mã số thuế.", 400);
    }

    const customer = await prisma.customer.create({
      data: {
        companyName: body.companyName,
        taxCode: body.taxCode,
        address: body.address || null,
        legalRepName: body.legalRepName || null,
        legalRepIdNumber: body.legalRepIdNumber || null,
        phone: body.phone || null,
        email: body.email || null,
        notes: body.notes || null,
      },
    });
    return apiSuccess(customer, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return apiError("Mã số thuế này đã tồn tại.", 409);
    }
    console.error("POST /api/customers failed:", error);
    return apiError("Không thể tạo khách hàng.", 500);
  }
}
