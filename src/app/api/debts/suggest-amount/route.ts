import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Suggests a starting totalAmount when the user picks a shipment while manually creating a Debt —
// never auto-creates a Debt, just prefills the form. RECEIVABLE suggests the shipment's latest Quote
// (Quote is already ACCOUNTANT-visible). PAYABLE would suggest Σ ShipmentCost.costPrice, but costPrice
// is ADMIN-only data (see CLAUDE.md "Profit visibility") — an ACCOUNTANT creating a PAYABLE debt gets
// no suggestion rather than silently leaking giá vốn through this side channel.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền xem công nợ.", 403);

  const shipmentId = request.nextUrl.searchParams.get("shipmentId");
  const type = request.nextUrl.searchParams.get("type");
  if (!shipmentId || (type !== "RECEIVABLE" && type !== "PAYABLE")) {
    return apiError("Thiếu tham số shipmentId hoặc type.", 400);
  }

  if (type === "RECEIVABLE") {
    const latestQuote = await prisma.quote.findFirst({
      where: { shipmentId },
      orderBy: { createdAt: "desc" },
      select: { quoteAmount: true },
    });
    return apiSuccess({ suggestedAmount: latestQuote?.quoteAmount ?? null });
  }

  if (user.role !== "ADMIN") {
    return apiSuccess({ suggestedAmount: null });
  }

  const costs = await prisma.shipmentCost.findMany({ where: { shipmentId }, select: { costPrice: true } });
  if (costs.length === 0) return apiSuccess({ suggestedAmount: null });
  const total = costs.reduce((sum, c) => sum + c.costPrice, 0);
  return apiSuccess({ suggestedAmount: total });
}
