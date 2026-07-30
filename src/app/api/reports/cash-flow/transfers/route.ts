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

function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text || null : undefined;
}

function isStoredAttachmentUrl(value: string) {
  return value.startsWith("/api/attachments/file/") || value.startsWith("/uploads/");
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(currentUser, "REPORTS")) {
    return apiError("Bạn không có quyền sử dụng báo cáo này.", 403);
  }
  if (currentUser.role !== "ADMIN" && currentUser.role !== "ACCOUNTANT") {
    return apiError("Chỉ quản trị viên hoặc kế toán được ghi nhận tạm ứng/hoàn ứng.", 403);
  }

  const body = await request.json();
  const fromUserId = typeof body.fromUserId === "string" ? body.fromUserId.trim() : "";
  const toUserId = typeof body.toUserId === "string" ? body.toUserId.trim() : "";
  const amount = Number(body.amount);
  const transferDate = parseTransferDate(body.transferDate);
  const transferType = body.transferType === "RETURN" ? "RETURN" : body.transferType === "ADVANCE" ? "ADVANCE" : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  const attachmentName = optionalText(body.attachmentName, 255);
  const attachmentUrl = optionalText(body.attachmentUrl, 1_024);

  if (!fromUserId || !toUserId) return apiError("Hãy chọn người chuyển và người nhận.", 400);
  if (fromUserId === toUserId) return apiError("Người chuyển và người nhận phải khác nhau.", 400);
  if (!Number.isFinite(amount) || amount <= 0) return apiError("Số tiền chuyển phải lớn hơn 0.", 400);
  if (!transferDate) return apiError("Ngày chuyển không hợp lệ.", 400);
  if (!transferType) return apiError("Loại tạm ứng/hoàn ứng không hợp lệ.", 400);
  if (attachmentName === undefined || attachmentUrl === undefined) {
    return apiError("Thông tin ảnh chuyển tiền không hợp lệ.", 400);
  }
  if (attachmentUrl && !isStoredAttachmentUrl(attachmentUrl)) {
    return apiError("Đường dẫn ảnh chuyển tiền không hợp lệ.", 400);
  }
  if (Boolean(attachmentName) !== Boolean(attachmentUrl)) {
    return apiError("Ảnh chuyển tiền phải có đủ tên tệp và đường dẫn.", 400);
  }

  const [fromUser, toUser] = await Promise.all([
    prisma.user.findFirst({ where: { id: fromUserId, isActive: true }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: toUserId, isActive: true }, select: { id: true } }),
  ]);
  if (!fromUser || !toUser) return apiError("Người chuyển hoặc người nhận không còn hoạt động.", 400);

  const transfer = await prisma.internalTransfer.create({
    data: {
      type: transferType,
      fromUserId,
      toUserId,
      amount: Math.round(amount),
      transferDate,
      note,
      attachmentName,
      attachmentUrl,
      createdById: currentUser.id,
    },
    select: { id: true },
  });

  return apiSuccess(transfer, 201);
}
