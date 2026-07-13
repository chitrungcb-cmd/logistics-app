import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";

// One batched query for every shipment's 6-step progress, instead of the /shipments list page (no
// pagination, hundreds of rows) making one GET /api/shipments/[id]/task-steps call per row — that
// would be hundreds of requests on a single page load. Returns just status per step (no assignee/
// timestamp — the compact dots on the list only need color, the full detail lives on the shipment
// detail page's TaskStepper).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const tasks = await prisma.task.findMany({
    where: { relatedShipmentId: { not: null }, title: { in: [...SHIPMENT_TASK_STEPS] } },
    select: { relatedShipmentId: true, title: true, status: true },
  });

  const byShipment = new Map<string, Record<string, string>>();
  for (const t of tasks) {
    const shipmentId = t.relatedShipmentId!;
    if (!byShipment.has(shipmentId)) byShipment.set(shipmentId, {});
    byShipment.get(shipmentId)![t.title] = t.status;
  }

  const result: Record<string, (string | null)[]> = {};
  for (const [shipmentId, statusByTitle] of byShipment) {
    result[shipmentId] = SHIPMENT_TASK_STEPS.map((title) => statusByTitle[title] ?? null);
  }

  return apiSuccess(result);
}
