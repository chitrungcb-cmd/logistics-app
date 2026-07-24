import { prisma } from "@/lib/prisma";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";

const MISSING_ACTUAL_COST_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Reconciles one idempotent alert per overdue shipment and recipient. A preset estimate does not
 * count as actual cost. Alerts disappear automatically once a user confirms/adds an actual row.
 */
export async function syncMissingActualCostAlerts(now = new Date()) {
  const cutoff = new Date(now.getTime() - MISSING_ACTUAL_COST_AFTER_MS);
  const [overdueShipments, recipients, existingAlerts] = await Promise.all([
    prisma.shipment.findMany({
      where: {
        declarationNo: { not: null },
        costs: { none: { isActual: true } },
        OR: [
          { declarationDate: { lte: cutoff } },
          { declarationDate: null, createdAt: { lte: cutoff } },
        ],
      },
      select: { id: true, declarationNo: true, customerName: true, goodsName: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: { in: ["ADMIN", "ACCOUNTANT"] } },
      select: { id: true },
    }),
    prisma.notification.findMany({
      where: { type: "COST_MISSING" },
      select: { id: true, relatedShipmentId: true },
    }),
  ]);

  const overdueIds = new Set(overdueShipments.map((shipment) => shipment.id));
  const resolvedAlertIds = existingAlerts
    .filter((alert) => !alert.relatedShipmentId || !overdueIds.has(alert.relatedShipmentId))
    .map((alert) => alert.id);
  const newAlerts = overdueShipments.flatMap((shipment) =>
    recipients.map((recipient) => ({
      userId: recipient.id,
      type: "COST_MISSING" as const,
      message: `⚠ Quá 3 ngày chưa có chi phí thực tế · TK ${shipment.declarationNo || "—"} · ${shipment.customerName}${shipment.goodsName ? ` · ${shipment.goodsName}` : ""}`,
      relatedShipmentId: shipment.id,
      dedupeKey: `cost-missing:${shipment.id}:${recipient.id}`,
    }))
  );

  await prisma.$transaction(async (tx) => {
    if (resolvedAlertIds.length > 0) {
      await tx.notification.deleteMany({ where: { id: { in: resolvedAlertIds } } });
    }
    if (newAlerts.length > 0) {
      await tx.notification.createMany({ data: newAlerts, skipDuplicates: true });
    }
  });
}

function shipmentAssignmentMessage(params: {
  declarationNo: string | null;
  customerName: string;
  goodsName: string | null;
}) {
  const details = [
    "Bạn được phân công phụ trách lô hàng",
    params.declarationNo ? `TK ${params.declarationNo}` : null,
    params.customerName,
    params.goodsName,
  ].filter((value): value is string => Boolean(value));
  return details.join(" · ");
}

export async function notifyShipmentAssigned(params: {
  recipientUserIds: string[];
  shipmentId: string;
  declarationNo: string | null;
  customerName: string;
  goodsName: string | null;
  dedupe?: boolean;
}) {
  const recipientUserIds = [...new Set(params.recipientUserIds)];
  if (recipientUserIds.length === 0) return;

  await prisma.notification.createMany({
    data: recipientUserIds.map((userId) => ({
      userId,
      // Reuse TASK_ASSIGNED so this remains compatible with the current notification enum. There
      // is intentionally no relatedTaskId: clicking the bell opens the shipment, not one of its six
      // workflow tasks.
      type: "TASK_ASSIGNED" as const,
      message: shipmentAssignmentMessage(params),
      relatedShipmentId: params.shipmentId,
      dedupeKey: params.dedupe ? `shipment-assigned:${params.shipmentId}:${userId}` : null,
    })),
    skipDuplicates: true,
  });
}

/** Sends one notification per assigned employee after a new shipment's workflow has been created. */
export async function notifyNewShipmentAssignees(params: {
  shipmentId: string;
  actorUserId: string;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    select: {
      declarationNo: true,
      customerName: true,
      goodsName: true,
      tasks: {
        where: { title: { in: [...SHIPMENT_TASK_STEPS] } },
        select: { assignedTo: { select: { id: true, isActive: true } } },
      },
    },
  });
  if (!shipment) return;

  const recipients = shipment.tasks
    .map((task) => task.assignedTo)
    .filter((assignedUser) => assignedUser.isActive && assignedUser.id !== params.actorUserId)
    .map((assignedUser) => assignedUser.id);

  await notifyShipmentAssigned({
    recipientUserIds: recipients,
    shipmentId: params.shipmentId,
    declarationNo: shipment.declarationNo,
    customerName: shipment.customerName,
    goodsName: shipment.goodsName,
    dedupe: true,
  });
}

export async function notifyTaskAssigned(params: {
  assignedToUserId: string;
  taskId: string;
  taskTitle: string;
  shipmentId: string | null;
}) {
  await prisma.notification.create({
    data: {
      userId: params.assignedToUserId,
      type: "TASK_ASSIGNED",
      message: `Bạn được giao: ${params.taskTitle}`,
      relatedTaskId: params.taskId,
      relatedShipmentId: params.shipmentId,
    },
  });
}

/** One notification per recipient (customer's phụ trách + task creator), skipping the acting user and de-duplicating. */
export async function notifyTaskProgressUpdate(params: {
  actorUserId: string;
  actorName: string;
  taskId: string;
  taskTitle: string;
  newStatusLabel: string;
  shipmentId: string | null;
  recipientUserIds: (string | null | undefined)[];
}) {
  const message = `${params.actorName} đã cập nhật ${params.taskTitle} sang ${params.newStatusLabel}`;
  const recipients = [...new Set(params.recipientUserIds.filter((id): id is string => !!id))].filter(
    (id) => id !== params.actorUserId
  );

  await Promise.all(
    recipients.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          type: "TASK_PROGRESS_UPDATE",
          message,
          relatedTaskId: params.taskId,
          relatedShipmentId: params.shipmentId,
        },
      })
    )
  );
}

/**
 * One notification per conversation member other than the sender (no realtime presence tracking in
 * this app, so — per spec — everyone else gets one regardless of whether they currently have the
 * conversation open). Mentioned members get a MENTIONED notification instead of NEW_MESSAGE — a
 * mention is a stronger signal, not an additional one.
 */
export async function notifyNewMessage(params: {
  senderId: string;
  senderName: string;
  conversationId: string;
  conversationName: string;
  memberUserIds: string[];
  mentionedUserIds: string[];
}) {
  const mentioned = new Set(params.mentionedUserIds);
  const recipients = params.memberUserIds.filter((id) => id !== params.senderId);

  await Promise.all(
    recipients.map((userId) =>
      prisma.notification.create({
        data: {
          userId,
          type: mentioned.has(userId) ? "MENTIONED" : "NEW_MESSAGE",
          message: mentioned.has(userId)
            ? `${params.senderName} đã nhắc đến bạn trong ${params.conversationName}`
            : `${params.senderName} đã gửi tin nhắn trong ${params.conversationName}`,
          relatedConversationId: params.conversationId,
        },
      })
    )
  );
}
