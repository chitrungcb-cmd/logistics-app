import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";

// Powers TaskStepper.tsx on the shipment detail page — deliberately visible to every role (unlike
// GET /api/tasks, which restricts FIELD_STAFF to only their own assigned tasks). This is a workflow
// *progress overview* for whoever is looking at the shipment, not a task list — it only exposes
// status/assignee/updatedAt per step, not full task detail (description, attachmentUrl, etc.).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const { id } = await params;
  const tasks = await prisma.task.findMany({
    where: { relatedShipmentId: id, title: { in: [...SHIPMENT_TASK_STEPS] } },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const steps = SHIPMENT_TASK_STEPS.map((title) => ({
    title,
    task: byTitle.get(title) ?? null,
  }));

  return apiSuccess(steps);
}
