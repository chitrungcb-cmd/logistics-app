import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";

// Quote totals are financial data, so keep them behind the same ADMIN boundary as /api/costs.
// Returning only the latest snapshot per shipment is enough for the cost overview to compute
// revenue without exposing quote data through the general-purpose /api/shipments endpoint.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role !== "ADMIN") return apiError("Bạn không có quyền xem tổng thu lô hàng.", 403);

    const shipments = await prisma.shipment.findMany({
      select: {
        id: true,
        quotes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { quoteAmount: true },
        },
      },
    });

    return apiSuccess(
      shipments.map((shipment) => ({
        shipmentId: shipment.id,
        quoteAmount: shipment.quotes[0]?.quoteAmount ?? 0,
      }))
    );
  } catch (error) {
    console.error("GET /api/costs/shipment-quote-totals failed:", error);
    return apiError("Không thể tải tổng thu theo lô hàng.", 500);
  }
}
