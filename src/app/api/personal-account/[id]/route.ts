import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { PERSONAL_ACCOUNT_ENTRY_INCLUDE, computePersonalAccountPayment } from "@/lib/personal-account-sync";
import { AUTOMATIC_RECEIVABLE_DEBT_PREFIX } from "@/lib/shipment-debt-sync";

function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text || null : undefined;
}

// `amount` luôn được đồng bộ từ báo giá không hóa đơn. Ngày thanh toán chỉ được ghi nhận qua
// Công nợ; endpoint này chỉ nhận các trường quản lý nội bộ của dòng.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa tài khoản cá nhân.", 403);
    const { id } = await params;
    const body = await request.json();
    if ("paymentDate" in body) {
      return apiError("Ngày thanh toán chỉ được ghi nhận tại mô-đun Công nợ.", 400);
    }
    const data: {
      receivingAccount?: string | null;
      assignedUserId?: string | null;
      note?: string | null;
    } = {};

    if ("receivingAccount" in body) {
      const receivingAccount = optionalText(body.receivingAccount, 200);
      if (receivingAccount === undefined) return apiError("Số tài khoản nhận tiền không hợp lệ.", 400);
      data.receivingAccount = receivingAccount;
    }
    if ("note" in body) {
      const note = optionalText(body.note, 2_000);
      if (note === undefined) return apiError("Ghi chú không hợp lệ.", 400);
      data.note = note;
    }
    if ("assignedUserId" in body) {
      if (body.assignedUserId == null || body.assignedUserId === "") {
        data.assignedUserId = null;
      } else {
        if (typeof body.assignedUserId !== "string") return apiError("Người phụ trách không hợp lệ.", 400);
        const assignee = await prisma.user.findUnique({
          where: { id: body.assignedUserId },
          select: { id: true },
        });
        if (!assignee) return apiError("Người phụ trách không tồn tại.", 400);
        data.assignedUserId = assignee.id;
      }
    }
    if (Object.keys(data).length === 0) return apiError("Không có trường nào để cập nhật.", 400);

    const existing = await prisma.personalAccountEntry.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Không tìm thấy dòng tài khoản cá nhân.", 404);

    const entry = await prisma.personalAccountEntry.update({
      where: { id },
      data,
      include: PERSONAL_ACCOUNT_ENTRY_INCLUDE,
    });
    // Trả kèm trạng thái thanh toán suy từ Công nợ để client cập nhật dòng nhất quán với GET.
    const debt = await prisma.debt.findFirst({
      where: {
        type: "RECEIVABLE",
        shipmentId: entry.shipmentId,
        sourceKey: { startsWith: AUTOMATIC_RECEIVABLE_DEBT_PREFIX },
      },
      select: { payments: { where: { portion: "NO_INVOICE" }, select: { amount: true, paymentDate: true } } },
    });
    return apiSuccess({
      ...entry,
      ...computePersonalAccountPayment({
        amount: entry.amount,
        noInvoicePayments: debt?.payments ?? [],
      }),
    });
  } catch (error) {
    console.error("PATCH /api/personal-account/[id] failed:", error);
    return apiError("Không thể cập nhật tài khoản cá nhân.", 500);
  }
}
