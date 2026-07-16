import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem nhà cung cấp.", 403);

  const search = request.nextUrl.searchParams.get("search")?.trim();

  const vendors = await prisma.vendor.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { taxCode: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
  });
  return apiSuccess(vendors);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền thêm nhà cung cấp.", 403);

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return apiError("Vui lòng nhập tên nhà cung cấp.", 400);

    const optionalText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

    const vendor = await prisma.vendor.create({
      data: {
        name,
        type: optionalText(body.type),
        phone: optionalText(body.phone),
        address: optionalText(body.address),
        taxCode: optionalText(body.taxCode),
        note: optionalText(body.note),
      },
    });
    return apiSuccess(vendor, 201);
  } catch (error) {
    console.error("POST /api/vendors failed:", error);
    return apiError("Không thể tạo nhà cung cấp.", 500);
  }
}
