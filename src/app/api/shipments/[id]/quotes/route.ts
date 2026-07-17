import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { syncShipmentDebts } from "@/lib/shipment-debt-sync";

// Quote (báo giá gửi khách) is visible to ADMIN and ACCOUNTANT — unlike ShipmentCost, ACCOUNTANT
// needs this to issue quotes to customers. FIELD_STAFF gets no access at all.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem báo giá.", 403);

  const { id } = await params;
  const quotes = await prisma.quote.findMany({
    where: { shipmentId: id },
    orderBy: { createdAt: "desc" },
  });
  return apiSuccess(quotes);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền thêm báo giá.", 403);

    const { id } = await params;
    const body = await request.json();

    if (body.quoteAmount === undefined || body.quoteAmount === null || body.quoteAmount === "") {
      return apiError("Vui lòng nhập số tiền báo giá.", 400);
    }

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          shipmentId: id,
          quoteAmount: Number(body.quoteAmount) || 0,
          quoteDate: body.quoteDate ? new Date(body.quoteDate) : null,
          attachmentUrl: body.attachmentUrl || null,
          note: body.note || null,
        },
      });
      await syncShipmentDebts(tx, id);
      return created;
    });
    return apiSuccess(quote, 201);
  } catch (error) {
    console.error("POST /api/shipments/[id]/quotes failed:", error);
    return apiError("Không thể thêm báo giá.", 500);
  }
}
