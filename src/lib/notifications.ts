import { prisma } from "@/lib/prisma";

/** Formats the "- Lô hàng {code}" suffix shared by both notification message templates. */
function shipmentSuffix(shipmentCode: string | null) {
  return shipmentCode ? ` - Lô hàng ${shipmentCode}` : "";
}

export async function notifyTaskAssigned(params: {
  assignedToUserId: string;
  taskId: string;
  taskTitle: string;
  shipmentId: string | null;
  shipmentCode: string | null;
}) {
  await prisma.notification.create({
    data: {
      userId: params.assignedToUserId,
      type: "TASK_ASSIGNED",
      message: `Bạn được giao: ${params.taskTitle}${shipmentSuffix(params.shipmentCode)}`,
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
  shipmentCode: string | null;
  recipientUserIds: (string | null | undefined)[];
}) {
  const message = `${params.actorName} đã cập nhật ${params.taskTitle} sang ${params.newStatusLabel}${shipmentSuffix(params.shipmentCode)}`;
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
