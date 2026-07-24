import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Tổng chi phí "do ai chi" (gom theo ShipmentCost.paidByUserId) cho báo cáo trong mô-đun Tài khoản
// cá nhân. costPrice là dữ liệu ADMIN-only end-to-end (xem CLAUDE.md "Profit visibility") — mô-đun
// Tài khoản cá nhân cho ACCOUNTANT xem được, nên riêng phần chi phí này phải chặn ở tầng API, không
// để rò giá vốn qua đường vòng.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem chi phí.", 403);

  const groups = await prisma.shipmentCost.groupBy({
    by: ["paidByUserId"],
    _sum: { costPrice: true },
    _count: { _all: true },
  });

  const userIds = groups.map((group) => group.paidByUserId).filter((id): id is string => Boolean(id));
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const rows = groups
    .map((group) => ({
      userId: group.paidByUserId,
      userName: group.paidByUserId ? nameById.get(group.paidByUserId) ?? "Người dùng đã xóa" : "Chưa chọn người chi",
      totalCost: group._sum.costPrice ?? 0,
      count: group._count._all,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  return apiSuccess(rows);
}
