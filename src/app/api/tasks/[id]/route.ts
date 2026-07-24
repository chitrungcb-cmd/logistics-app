import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { notifyTaskAssigned, notifyTaskProgressUpdate } from "@/lib/notifications";
import { TASK_STATUS_LABELS } from "@/lib/task-constants";

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  relatedShipment: { select: { id: true, shipmentCode: true, customerName: true } },
  statusLogs: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

// Fields a FIELD_STAFF may change on their own task: progress status, a progress note (reuses
// `description`), and the completion attachment. Everything else (title, assignee, due date, related
// shipment) is creator-controlled.
const FIELD_STAFF_EDITABLE_FIELDS = ["status", "description", "attachmentUrl"] as const;
const MANAGER_EDITABLE_FIELDS = [
  "title",
  "description",
  "assignedToUserId",
  "status",
  "dueDate",
  "relatedShipmentId",
  "attachmentUrl",
] as const;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  const { id } = await params;
  const task = await prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
  if (!task) return apiError("Không tìm thấy nhiệm vụ.", 404);

  if (user.role === "FIELD_STAFF" && task.assignedToUserId !== user.id) {
    return apiError("Bạn không có quyền xem nhiệm vụ này.", 403);
  }

  return apiSuccess(task);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);

    const { id } = await params;
    const existing = await prisma.task.findUnique({
      where: { id },
      include: {
        relatedShipment: { select: { id: true, customer: { select: { assignedUserId: true } } } },
      },
    });
    if (!existing) return apiError("Không tìm thấy nhiệm vụ.", 404);

    const isFieldStaff = user.role === "FIELD_STAFF";
    if (isFieldStaff && existing.assignedToUserId !== user.id) {
      return apiError("Bạn không có quyền sửa nhiệm vụ này.", 403);
    }

    const body = await request.json();
    const allowedFields = isFieldStaff ? FIELD_STAFF_EDITABLE_FIELDS : MANAGER_EDITABLE_FIELDS;
    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) data[field] = body[field];
    }
    if ("dueDate" in data && data.dueDate) data.dueDate = new Date(data.dueDate as string);

    if (Object.keys(data).length === 0) {
      return apiError("Không có dữ liệu để cập nhật.", 400);
    }

    const task = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });

    const statusLog =
      typeof data.status === "string" && data.status !== existing.status
        ? await prisma.taskStatusLog.create({
            data: {
              taskId: task.id,
              actorUserId: user.id,
              fromStatus: existing.status,
              toStatus: data.status as typeof existing.status,
            },
            include: { actor: { select: { id: true, name: true } } },
          })
        : null;

    const shipmentId = existing.relatedShipment?.id ?? null;

    if (typeof data.assignedToUserId === "string" && data.assignedToUserId !== existing.assignedToUserId) {
      await notifyTaskAssigned({
        assignedToUserId: data.assignedToUserId,
        taskId: task.id,
        taskTitle: task.title,
        shipmentId,
      });
    }

    if (typeof data.status === "string" && data.status !== existing.status) {
      await notifyTaskProgressUpdate({
        actorUserId: user.id,
        actorName: user.name,
        taskId: task.id,
        taskTitle: task.title,
        newStatusLabel: TASK_STATUS_LABELS[data.status] ?? data.status,
        shipmentId,
        recipientUserIds: [existing.relatedShipment?.customer?.assignedUserId, existing.createdByUserId],
      });
    }

    return apiSuccess(statusLog ? { ...task, statusLogs: [statusLog, ...task.statusLogs] } : task);
  } catch (error) {
    console.error("PATCH /api/tasks/[id] failed:", error);
    return apiError("Không thể cập nhật nhiệm vụ.", 500);
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") {
      return apiError("Nhân viên hiện trường không được xóa nhiệm vụ.", 403);
    }

    const { id } = await params;
    await prisma.task.delete({ where: { id } });
    return apiSuccess({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
      return apiError("Không tìm thấy nhiệm vụ.", 404);
    }
    console.error("DELETE /api/tasks/[id] failed:", error);
    return apiError("Không thể xóa nhiệm vụ.", 500);
  }
}
