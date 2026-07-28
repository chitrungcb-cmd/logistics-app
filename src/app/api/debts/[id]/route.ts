import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { computeDebtStatus, sumPayments } from "@/lib/debt-constants";
import { isAutomaticDebt, isAutomaticPayableDebt } from "@/lib/shipment-debt-sync";
import { getShipmentFinanceLinks } from "@/lib/shipment-invoice-links";

const UPDATABLE_FIELDS = ["totalAmount", "dueDate", "note", "shipmentId"] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem công nợ.", 403);

  const { id } = await params;
  const debt = await prisma.debt.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, companyName: true, taxCode: true } },
      vendor: { select: { id: true, name: true } },
      shipment: {
        select: {
          id: true,
          shipmentCode: true,
          goodsName: true,
          declarationNo: true,
          declarationDate: true,
          invoiceNo: true,
          customerName: true,
        },
      },
      payments: {
        orderBy: { paymentDate: "desc" },
        include: {
          receivedToCompanyAccount: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!debt) return apiError("Không tìm thấy công nợ.", 404);
  // ADMIN + ACCOUNTANT đều được xem công nợ Phải trả tự động (để tích chi phí đã trả); FIELD_STAFF
  // đã bị chặn ở đầu hàm.

  const paidAmount = sumPayments(debt.payments);
  const financeLinks = debt.shipmentId ? await getShipmentFinanceLinks(debt.shipmentId) : null;
  // Với công nợ Phải trả: kèm danh sách dòng chi phí thực tế để tích "đã thanh toán" từng khoản.
  const payableCosts =
    debt.type === "PAYABLE" && debt.shipmentId
      ? await prisma.shipmentCost.findMany({
          where: { shipmentId: debt.shipmentId, isActual: true, costPrice: { gt: 0 } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            category: true,
            customLabel: true,
            unit: true,
            quantity: true,
            costPrice: true,
            isPaid: true,
            paidAt: true,
            vendor: { select: { name: true } },
            paidBy: { select: { id: true, name: true } },
            paidFromCompanyAccount: { select: { id: true, name: true } },
            paidConfirmedBy: { select: { name: true } },
          },
        })
      : [];
  return apiSuccess({
    ...debt,
    paidAmount,
    remainingAmount: debt.totalAmount - paidAmount,
    linkedInvoices: financeLinks?.invoices ?? [],
    payableCosts,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền sửa công nợ.", 403);

    const { id } = await params;
    const body = await request.json();

    const data: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) {
        if (field === "totalAmount") data.totalAmount = Number(body.totalAmount);
        else if (field === "dueDate") data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
        else data[field] = body[field] || null;
      }
    }
    if (Object.keys(data).length === 0) return apiError("Không có dữ liệu để cập nhật.", 400);

    const existing = await prisma.debt.findUnique({ where: { id }, include: { payments: { select: { amount: true } } } });
    if (!existing) return apiError("Không tìm thấy công nợ.", 404);
    // ACCOUNTANT được sửa ngày thanh toán (dueDate)/ghi chú của công nợ Phải trả tự động; chỉ số tiền
    // và lô hàng mới giữ riêng cho ADMIN (khối bên dưới chặn với mọi công nợ tự động).
    const touchesAmountOrShipment = "totalAmount" in body || "shipmentId" in body;
    if (user.role !== "ADMIN" && isAutomaticPayableDebt(existing.sourceKey) && touchesAmountOrShipment) {
      return apiError("Chỉ quản trị viên được sửa số tiền/lô hàng của công nợ chi phí tự động.", 403);
    }
    if (isAutomaticDebt(existing.sourceKey) && touchesAmountOrShipment) {
      return apiError("Số tiền và lô hàng của công nợ tự động được cập nhật từ tài chính lô hàng.", 400);
    }

    const newTotalAmount = typeof data.totalAmount === "number" ? data.totalAmount : existing.totalAmount;
    const paidAmount = sumPayments(existing.payments);
    data.status = computeDebtStatus(newTotalAmount, paidAmount);

    const debt = await prisma.debt.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, companyName: true, taxCode: true } },
        vendor: { select: { id: true, name: true } },
        shipment: {
          select: {
            id: true,
            shipmentCode: true,
            goodsName: true,
            declarationNo: true,
            declarationDate: true,
            invoiceNo: true,
            customerName: true,
          },
        },
      },
    });

    return apiSuccess({ ...debt, paidAmount, remainingAmount: debt.totalAmount - paidAmount });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy công nợ.", 404);
    }
    console.error("PATCH /api/debts/[id] failed:", error);
    return apiError("Không thể cập nhật công nợ.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xóa công nợ.", 403);

    const { id } = await params;
    const existing = await prisma.debt.findUnique({ where: { id }, select: { sourceKey: true } });
    if (!existing) return apiError("Không tìm thấy công nợ.", 404);
    if (user.role !== "ADMIN" && isAutomaticPayableDebt(existing.sourceKey)) {
      return apiError("Bạn không có quyền xóa công nợ chi phí tự động.", 403);
    }
    if (isAutomaticDebt(existing.sourceKey)) {
      return apiError("Công nợ này được đồng bộ tự động từ tài chính lô hàng và không thể xóa trực tiếp.", 400);
    }
    await prisma.debt.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy công nợ.", 404);
    }
    console.error("DELETE /api/debts/[id] failed:", error);
    return apiError("Không thể xóa công nợ.", 500);
  }
}
