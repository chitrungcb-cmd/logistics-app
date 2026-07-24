import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api-response";
import { notifyTaskAssigned } from "@/lib/notifications";
import { adHocTaskWhere } from "@/lib/task-constants";
import { paginationMeta, parsePagination } from "@/lib/pagination";

const TASK_INCLUDE = {
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  relatedShipment: { select: { id: true, customerName: true, declarationNo: true } },
} as const;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return apiError("Chưa đăng nhập.", 401);

  // Fixed steps belong to the shipment progress UI. This module is an inbox for work assigned
  // outside that progress; FIELD_STAFF additionally only sees work assigned to themselves.
  const where = user.role === "FIELD_STAFF"
    ? { AND: [adHocTaskWhere(), { assignedToUserId: user.id }] }
    : adHocTaskWhere();

  const params = request.nextUrl.searchParams;
  if (!params.has("page") && !params.has("pageSize")) {
    const tasks = await prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(tasks);
  }

  const { page, pageSize, skip } = parsePagination(params);
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.task.count({ where }),
  ]);
  return apiSuccess({ items: tasks, pagination: paginationMeta(page, pageSize, total) });
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError("Chưa đăng nhập.", 401);
    if (user.role === "FIELD_STAFF") {
      return apiError("Nhân viên hiện trường không được tạo nhiệm vụ mới.", 403);
    }

    const body = await request.json();
    if (!body.title || !body.assignedToUserId) {
      return apiError("Vui lòng nhập tiêu đề và người được giao việc.", 400);
    }

    const task = await prisma.task.create({
      data: {
        title: body.title,
        description: body.description || null,
        assignedToUserId: body.assignedToUserId,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        relatedShipmentId: body.relatedShipmentId || null,
        attachmentUrl: body.attachmentUrl || null,
        createdByUserId: user.id,
      },
      include: TASK_INCLUDE,
    });

    // Skip self-notification — a manager assigning a task to themselves doesn't need to be told.
    if (task.assignedToUserId !== user.id) {
      await notifyTaskAssigned({
        assignedToUserId: task.assignedToUserId,
        taskId: task.id,
        taskTitle: task.title,
        shipmentId: task.relatedShipment?.id ?? null,
      });
    }

    return apiSuccess(task, 201);
  } catch (error) {
    console.error("POST /api/tasks failed:", error);
    return apiError("Không thể tạo nhiệm vụ.", 500);
  }
}
