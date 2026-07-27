import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";

// "Chi phí ai sửa hay thao tác sẽ có lịch sử thao tác" — every create/update/delete on a
// ShipmentCost is logged (see src/lib/cost-audit-log.ts); this lists them for one shipment, newest
// first. Viewing follows the same COSTS module permission as the ledger itself.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(user, "COSTS")) return apiError("Bạn không có quyền xem lịch sử thao tác.", 403);

  const shipmentId = request.nextUrl.searchParams.get("shipmentId");
  if (!shipmentId) return apiError("Thiếu lô hàng.", 400);

  const logs = await prisma.costAuditLog.findMany({
    where: { shipmentId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess(logs);
}
