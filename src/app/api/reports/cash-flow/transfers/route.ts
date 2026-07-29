import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { hasModuleAccess } from "@/lib/module-permissions";

function parseTransferDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(currentUser, "REPORTS")) {
    return apiError("Bạn không có quyền sử dụng báo cáo này.", 403);
  }
  if (currentUser.role !== "ADMIN" && currentUser.role !== "ACCOUNTANT") {
    return apiError("Chỉ quản trị viên hoặc kế toán được ghi nhận chuyển nội bộ.", 403);
  }

  const body = await request.json();
  const fromUserId = typeof body.fromUserId === "string" ? body.fromUserId.trim() : "";
  const toUserId = typeof body.toUserId === "string" ? body.toUserId.trim() : "";
  const amount = Number(body.amount);
  const transferDate = parseTransferDate(body.transferDate);
  const shipmentId = typeof body.shipmentId === "string" && body.shipmentId.trim()
    ? body.shipmentId.trim()
    : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  if (!fromUserId || !toUserId) return apiError("Hãy chọn người chuyển và người nhận.", 400);
  if (fromUserId === toUserId) return apiError("Người chuyển và người nhận phải khác nhau.", 400);
  if (!Number.isFinite(amount) || amount <= 0) return apiError("Số tiền chuyển phải lớn hơn 0.", 400);
  if (!transferDate) return apiError("Ngày chuyển không hợp lệ.", 400);

  const [fromUser, toUser, shipment] = await Promise.all([
    prisma.user.findFirst({ where: { id: fromUserId, isActive: true }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: toUserId, isActive: true }, select: { id: true } }),
    shipmentId
      ? prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } })
      : Promise.resolve(null),
  ]);
  if (!fromUser || !toUser) return apiError("Người chuyển hoặc người nhận không còn hoạt động.", 400);
  if (shipmentId && !shipment) return apiError("Lô hàng liên quan không tồn tại.", 400);

  const transfer = await prisma.internalTransfer.create({
    data: {
      fromUserId,
      toUserId,
      amount: Math.round(amount),
      transferDate,
      shipmentId,
      note,
      createdById: currentUser.id,
    },
    select: { id: true },
  });

  return apiSuccess(transfer, 201);
}
