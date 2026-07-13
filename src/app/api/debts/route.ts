import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { computeDebtStatus, sumPayments } from "@/lib/debt-constants";

const SHIPMENT_SELECT = {
  id: true,
  shipmentCode: true,
  goodsName: true,
  declarationNo: true,
  declarationDate: true,
  invoiceNo: true,
} as const;

// Fetched once, unfiltered (mirrors the /api/costs "fetch all, filter client-side" pattern) — /debts
// needs cross-type KPI totals (Tổng phải thu + Tổng phải trả + Tổng quá hạn) that span both tabs, so
// the client always has the full unfiltered set on hand rather than re-querying per filter change.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem công nợ.", 403);

  const debts = await prisma.debt.findMany({
    include: {
      customer: { select: { id: true, companyName: true, taxCode: true } },
      vendor: { select: { id: true, name: true } },
      shipment: { select: SHIPMENT_SELECT },
      payments: { select: { amount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = debts.map(({ payments, ...debt }) => {
    const paidAmount = sumPayments(payments);
    return { ...debt, paidAmount, remainingAmount: debt.totalAmount - paidAmount };
  });

  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền tạo công nợ.", 403);

    const body = await request.json();
    const { type, customerId, vendorId, shipmentId, totalAmount, dueDate, note } = body;

    if (type !== "RECEIVABLE" && type !== "PAYABLE") {
      return apiError("Loại công nợ không hợp lệ.", 400);
    }
    if (type === "RECEIVABLE" && !customerId) {
      return apiError("Vui lòng chọn khách hàng.", 400);
    }
    if (type === "PAYABLE" && !vendorId) {
      return apiError("Vui lòng chọn nhà cung cấp.", 400);
    }
    if (!totalAmount || Number(totalAmount) <= 0) {
      return apiError("Vui lòng nhập tổng tiền hợp lệ.", 400);
    }

    const debt = await prisma.debt.create({
      data: {
        type,
        customerId: type === "RECEIVABLE" ? customerId : null,
        vendorId: type === "PAYABLE" ? vendorId : null,
        shipmentId: shipmentId || null,
        totalAmount: Number(totalAmount),
        dueDate: dueDate ? new Date(dueDate) : null,
        status: computeDebtStatus(Number(totalAmount), 0),
        note: note || null,
      },
      include: {
        customer: { select: { id: true, companyName: true, taxCode: true } },
        vendor: { select: { id: true, name: true } },
        shipment: { select: SHIPMENT_SELECT },
      },
    });

    return apiSuccess({ ...debt, paidAmount: 0, remainingAmount: debt.totalAmount }, 201);
  } catch (error) {
    console.error("POST /api/debts failed:", error);
    return apiError("Không thể tạo công nợ.", 500);
  }
}
