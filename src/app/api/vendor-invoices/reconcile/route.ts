import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { reconcileStoredVendorInvoices } from "@/lib/vendor-invoice-reconciliation";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") return apiError("Bạn không có quyền đối chiếu hóa đơn.", 403);

    return apiSuccess(await reconcileStoredVendorInvoices());
  } catch (error) {
    console.error("POST /api/vendor-invoices/reconcile failed:", error);
    return apiError("Không thể đối chiếu lại hóa đơn.", 500);
  }
}
