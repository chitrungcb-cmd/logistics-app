import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { sumPayments } from "@/lib/debt-constants";

// Công nợ (phải thu + phải trả) của một lô hàng, dùng cho cửa sổ Thông tin lô hàng. FIELD_STAFF
// không được xem công nợ; ADMIN và ACCOUNTANT đều xem + sửa được ngày thanh toán (canEditDate).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem công nợ.", 403);

  const { id } = await params;
  const debts = await prisma.debt.findMany({
    where: { shipmentId: id },
    orderBy: { type: "asc" },
    include: {
      customer: { select: { companyName: true } },
      vendor: { select: { name: true } },
      shipment: { select: { customerName: true } },
      payments: { select: { amount: true } },
    },
  });

  // Các dòng chi phí thực tế của lô — hiển thị ngay trong công nợ Phải trả để tích "đã thanh toán"
  // mà không phải mở trang chi tiết. canTick: ADMIN hoặc đúng người được gán "Do ai chi" (paidBy).
  const hasPayable = debts.some((debt) => debt.type === "PAYABLE");
  const costs = hasPayable
    ? await prisma.shipmentCost.findMany({
        where: { shipmentId: id, isActual: true, costPrice: { gt: 0 } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          category: true,
          customLabel: true,
          costPrice: true,
          isPaid: true,
          paidAt: true,
          vendor: { select: { name: true } },
          paidBy: { select: { id: true, name: true } },
          paidConfirmedBy: { select: { name: true } },
        },
      })
    : [];
  const payableCosts = costs.map((cost) => ({
    id: cost.id,
    category: cost.category,
    customLabel: cost.customLabel,
    costPrice: cost.costPrice,
    isPaid: cost.isPaid,
    paidAt: cost.paidAt,
    vendorName: cost.vendor?.name ?? null,
    paidByName: cost.paidBy?.name ?? null,
    paidConfirmedByName: cost.paidConfirmedBy?.name ?? null,
    canTick: user.role === "ADMIN" || cost.paidBy?.id === user.id,
  }));

  const data = debts.map((debt) => {
    const paidAmount = sumPayments(debt.payments);
    const partnerName =
      debt.type === "RECEIVABLE"
        ? debt.customer?.companyName || debt.shipment?.customerName || "Khách hàng"
        : debt.vendor?.name || "Chi phí lô hàng";
    // Cả ADMIN và ACCOUNTANT đều sửa được ngày thanh toán (FIELD_STAFF đã bị chặn ở đầu hàm).
    const canEditDate = true;
    return {
      id: debt.id,
      type: debt.type,
      partnerName,
      totalAmount: debt.totalAmount,
      paidAmount,
      remainingAmount: debt.totalAmount - paidAmount,
      dueDate: debt.dueDate,
      status: debt.status,
      canEditDate,
      costs: debt.type === "PAYABLE" ? payableCosts : [],
    };
  });
  return apiSuccess(data);
}
