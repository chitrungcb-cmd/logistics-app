import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { isOtherEntryType, isOtherExpenseCategory } from "@/lib/other-expense-constants";
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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (!hasModuleAccess(user, "OTHER_EXPENSES")) {
    return apiError("Bạn không có quyền xem chi phí khác.", 403);
  }

  const expenses = await prisma.otherExpense.findMany({
    include: { createdBy: { select: CREATOR_SELECT } },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
  });
  return apiSuccess(expenses);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (!hasModuleAccess(user, "OTHER_EXPENSES")) {
      return apiError("Bạn không có quyền thêm chi phí khác.", 403);
    }

    const body = await request.json();
    // Khoản THU chỉ có một nhóm "Thu khác" → lưu category = KHAC; khoản CHI dùng nhóm chi do client gửi.
    const type = isOtherEntryType(body.type) ? body.type : "CHI";
    const category = type === "THU" ? "KHAC" : body.category;
    if (!isOtherExpenseCategory(category)) return apiError("Nhóm không hợp lệ.", 400);

    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description || description.length > 300) {
      return apiError("Nội dung là bắt buộc và không vượt quá 300 ký tự.", 400);
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return apiError("Số tiền phải lớn hơn 0.", 400);

    const expenseDate = new Date(body.expenseDate);
    if (!body.expenseDate || Number.isNaN(expenseDate.getTime())) return apiError("Ngày chi không hợp lệ.", 400);

    const payee = optionalText(body.payee, 200);
    const paymentMethod = optionalText(body.paymentMethod, 100);
    const invoiceNumber = optionalText(body.invoiceNumber, 100);
    const attachmentName = optionalText(body.attachmentName, 255);
    const attachmentUrl = optionalText(body.attachmentUrl, 1_024);
    const note = optionalText(body.note, 2_000);
    if ([payee, paymentMethod, invoiceNumber, attachmentName, attachmentUrl, note].includes(undefined)) {
      return apiError("Một trường văn bản không đúng định dạng hoặc vượt quá độ dài cho phép.", 400);
    }
    if (attachmentUrl && !isStoredAttachmentUrl(attachmentUrl)) {
      return apiError("Đường dẫn chứng từ không hợp lệ.", 400);
    }

    const companyAccountId =
      typeof body.companyAccountId === "string" && body.companyAccountId ? body.companyAccountId : null;
    if (companyAccountId) {
      const account = await prisma.companyAccount.findUnique({ where: { id: companyAccountId }, select: { id: true } });
      if (!account) return apiError("Tài khoản công ty không hợp lệ.", 400);
    }

    const expense = await prisma.otherExpense.create({
      data: {
        type,
        category,
        description,
        amount,
        expenseDate,
        payee,
        paymentMethod,
        companyAccountId,
        invoiceNumber,
        attachmentName,
        attachmentUrl,
        note,
        createdById: user.id,
      },
      include: { createdBy: { select: CREATOR_SELECT }, companyAccount: { select: { id: true, name: true } } },
    });
    return apiSuccess(expense, 201);
  } catch (error) {
    console.error("POST /api/other-expenses failed:", error);
    return apiError("Không thể thêm chi phí khác.", 500);
  }
}
