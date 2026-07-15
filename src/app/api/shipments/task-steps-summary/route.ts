import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";
import { backfillShipmentWorkflowTasks } from "@/lib/shipment-workflow";

// One batched query for every shipment's 6-step progress, instead of the /shipments list page (no
// pagination, hundreds of rows) making one GET /api/shipments/[id]/task-steps call per row — that
// would be hundreds of requests on a single page load. Returns just status per step (no assignee/
// timestamp — the compact dots on the list only need color, the full detail lives on the shipment
// detail page's TaskStepper).
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    if (user.role === "ADMIN") {
      await backfillShipmentWorkflowTasks({ createdByUserId: user.id });
    }

    const tasks = await prisma.task.findMany({
      where: { relatedShipmentId: { not: null }, title: { in: [...SHIPMENT_TASK_STEPS] } },
      select: { relatedShipmentId: true, title: true, status: true },
    });

    const byShipment = new Map<string, Record<string, string>>();
    for (const task of tasks) {
      const shipmentId = task.relatedShipmentId!;
      if (!byShipment.has(shipmentId)) byShipment.set(shipmentId, {});
      byShipment.get(shipmentId)![task.title] = task.status;
    }

    const result: Record<string, (string | null)[]> = {};
    for (const [shipmentId, statusByTitle] of byShipment) {
      result[shipmentId] = SHIPMENT_TASK_STEPS.map((title) => statusByTitle[title] ?? null);
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("GET /api/shipments/task-steps-summary failed:", error);
    return apiError("Không thể khởi tạo tiến trình cho các lô hàng.", 500);
  }
}
