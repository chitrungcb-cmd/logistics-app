import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { getShipmentFinanceLinks } from "@/lib/shipment-invoice-links";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);
  if (user.role !== "ADMIN") return apiError("Chỉ quản trị viên được xem liên kết chi phí và công nợ.", 403);

  const { id } = await params;
  const links = await getShipmentFinanceLinks(id);
  if (!links) return apiError("Không tìm thấy lô hàng.", 404);
  return apiSuccess(links);
}
