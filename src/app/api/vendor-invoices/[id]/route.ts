import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { determineInvoiceDirection } from "@/lib/vendor-invoice-parser";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền liên kết hóa đơn.", 403);

  const { id } = await params;
  const body = await request.json();
  const shipmentId = typeof body.shipmentId === "string" && body.shipmentId.trim()
    ? body.shipmentId.trim()
    : null;

  const invoice = await prisma.vendorInvoice.findUnique({ where: { id } });
  if (!invoice) return apiError("Không tìm thấy hóa đơn.", 404);
  const direction = determineInvoiceDirection(
    invoice.sellerName,
    invoice.sellerTaxCode,
    invoice.buyerName,
    invoice.buyerTaxCode
  );
  if (direction !== "OUTPUT") return apiError("Chỉ chọn lô hàng trực tiếp cho hóa đơn bán ra.", 400);

  if (shipmentId) {
    const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true } });
    if (!shipment) return apiError("Không tìm thấy lô hàng đã chọn.", 404);
  }

  const updated = await prisma.vendorInvoice.update({
    where: { id },
    data: {
      shipmentId,
      status: shipmentId ? "MATCHED" : "UNMATCHED",
    },
    select: { id: true, shipmentId: true, status: true },
  });
  return apiSuccess(updated);
}
