import { prisma } from "@/lib/prisma";
import { notifyTaskAssigned } from "@/lib/notifications";

// Nhiệm vụ tham vấn giá luôn giao cho một người phụ trách cố định toàn công ty (Linh), tra theo EMAIL
// cho ổn định giữa các môi trường (giống STEP_ASSIGNEE_EMAIL_OVERRIDES của workflow). Nếu tài khoản này
// bị khóa/không tồn tại thì bỏ qua, không chặn sync.
export const CONSULTATION_TASK_TITLE = "Tham vấn giá";
const CONSULTATION_ASSIGNEE_EMAIL = "doandieulinh131191@gmail.com"; // Linh

async function findAssignee() {
  return prisma.user.findFirst({
    where: { email: CONSULTATION_ASSIGNEE_EMAIL, isActive: true },
    select: { id: true },
  });
}

/**
 * Đảm bảo lô có lịch tham vấn (consultationDate/TGTV) thì có đúng MỘT nhiệm vụ "Tham vấn giá" giao cho
 * Linh, hạn = ngày tham vấn. Idempotent theo (title + relatedShipmentId): chạy lại sync không tạo trùng,
 * chỉ đồng bộ lại hạn khi ngày tham vấn đổi; KHÔNG đụng status (Linh có thể đã tích hoàn thành).
 */
export async function ensureConsultationTask(params: { shipmentId: string; createdByUserId: string }) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    select: { id: true, consultationDate: true, declarationNo: true },
  });
  if (!shipment?.consultationDate) return null;

  const existing = await prisma.task.findFirst({
    where: { relatedShipmentId: shipment.id, title: CONSULTATION_TASK_TITLE },
    select: { id: true, dueDate: true },
  });
  if (existing) {
    if (!existing.dueDate || existing.dueDate.getTime() !== shipment.consultationDate.getTime()) {
      await prisma.task.update({ where: { id: existing.id }, data: { dueDate: shipment.consultationDate } });
    }
    return existing.id;
  }

  const assignee = await findAssignee();
  if (!assignee) return null;

  const task = await prisma.task.create({
    data: {
      title: CONSULTATION_TASK_TITLE,
      description: shipment.declarationNo ? `Tham vấn giá tờ khai ${shipment.declarationNo}` : "Tham vấn giá",
      assignedToUserId: assignee.id,
      createdByUserId: params.createdByUserId,
      dueDate: shipment.consultationDate,
      relatedShipmentId: shipment.id,
      status: "TODO",
    },
  });
  // notifyTaskAssigned tự lọc người thực hiện = người được giao (không tự báo cho chính mình).
  await notifyTaskAssigned({
    assignedToUserId: assignee.id,
    taskId: task.id,
    taskTitle: CONSULTATION_TASK_TITLE,
    shipmentId: shipment.id,
  });
  return task.id;
}

/** Backfill: tạo nhiệm vụ tham vấn cho mọi lô đang có consultationDate mà chưa có nhiệm vụ. */
export async function backfillConsultationTasks(createdByUserId: string) {
  const shipments = await prisma.shipment.findMany({
    where: { consultationDate: { not: null } },
    select: { id: true },
  });
  let created = 0;
  for (const s of shipments) {
    const before = await prisma.task.findFirst({
      where: { relatedShipmentId: s.id, title: CONSULTATION_TASK_TITLE },
      select: { id: true },
    });
    await ensureConsultationTask({ shipmentId: s.id, createdByUserId });
    if (!before) created += 1;
  }
  return { scanned: shipments.length, created };
}
