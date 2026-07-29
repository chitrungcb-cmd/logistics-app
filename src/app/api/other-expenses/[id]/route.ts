import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { isOtherExpenseCategory } from "@/lib/other-expense-constants";
import { hasModuleAccess } from "@/lib/module-permissions";

const CREATOR_SELECT = { id: true, name: true } as const;

function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length <= maxLength ? text || null : undefined;
}

function isStoredAttachmentUrl(value: string) {
  return value.startsWith("/api/attachments/file/") || value.startsWith("/uploads/");
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "OTHER_EXPENSES")) {
      return apiError("Bạn không có quyền sửa chi phí khác.", 403);
    }

    const { id } = await params;
    const existing = await prisma.otherExpense.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Không tìm thấy khoản chi phí.", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if ("category" in body) {
      if (!isOtherExpenseCategory(body.category)) return apiError("Nhóm chi phí không hợp lệ.", 400);
      data.category = body.category;
    }
    if ("description" in body) {
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!description || description.length > 300) {
        return apiError("Nội dung chi phí là bắt buộc và không vượt quá 300 ký tự.", 400);
      }
      data.description = description;
    }
    if ("amount" in body) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return apiError("Số tiền phải lớn hơn 0.", 400);
      data.amount = amount;
    }
    if ("expenseDate" in body) {
      const expenseDate = new Date(body.expenseDate);
      if (!body.expenseDate || Number.isNaN(expenseDate.getTime())) return apiError("Ngày chi không hợp lệ.", 400);
      data.expenseDate = expenseDate;
    }

    const textFields = {
      payee: 200,
      paymentMethod: 100,
      invoiceNumber: 100,
      attachmentName: 255,
      attachmentUrl: 1_024,
      note: 2_000,
    } as const;
    for (const [field, maxLength] of Object.entries(textFields)) {
      if (field in body) {
        const value = optionalText(body[field], maxLength);
        if (value === undefined) return apiError(`${field} không đúng định dạng.`, 400);
        data[field] = value;
      }
    }
    if (typeof data.attachmentUrl === "string" && !isStoredAttachmentUrl(data.attachmentUrl)) {
      return apiError("Đường dẫn chứng từ không hợp lệ.", 400);
    }
    if (Object.keys(data).length === 0) return apiError("Không có dữ liệu để cập nhật.", 400);

    const expense = await prisma.otherExpense.update({
      where: { id },
      data,
      include: { createdBy: { select: CREATOR_SELECT } },
    });
    return apiSuccess(expense);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy khoản chi phí.", 404);
    }
    console.error("PATCH /api/other-expenses/[id] failed:", error);
    return apiError("Không thể cập nhật chi phí khác.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "OTHER_EXPENSES")) {
      return apiError("Bạn không có quyền xóa chi phí khác.", 403);
    }

    const { id } = await params;
    await prisma.otherExpense.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy khoản chi phí.", 404);
    }
    console.error("DELETE /api/other-expenses/[id] failed:", error);
    return apiError("Không thể xóa chi phí khác.", 500);
  }
}
