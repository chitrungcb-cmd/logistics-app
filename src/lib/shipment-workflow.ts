import { prisma } from "@/lib/prisma";
import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";
import { notifyShipmentAssigned } from "@/lib/notifications";

type WorkflowBackfillResult = {
  shipmentsUpdated: number;
  tasksCreated: number;
};

let activeBackfill: Promise<WorkflowBackfillResult> | null = null;

/**
 * Steps always handled by one designated person company-wide, regardless of which manager owns
 * the customer. Looked up by email (stable across environments, unlike user ids); when the
 * designated account is missing or locked the step falls back to the normal assignee.
 */
const STEP_ASSIGNEE_EMAIL_OVERRIDES: Partial<Record<(typeof SHIPMENT_TASK_STEPS)[number], string>> = {
  "Xuất hóa đơn VAT": "quynhquynh91sm@gmail.com",
};

async function resolveStepAssigneeOverrides(): Promise<Map<string, string>> {
  const emails = [...new Set(Object.values(STEP_ASSIGNEE_EMAIL_OVERRIDES))];
  if (emails.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { email: { in: emails }, isActive: true },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((user) => [user.email, user.id]));
  const byTitle = new Map<string, string>();
  for (const [title, email] of Object.entries(STEP_ASSIGNEE_EMAIL_OVERRIDES)) {
    const userId = idByEmail.get(email);
    if (userId) byTitle.set(title, userId);
  }
  return byTitle;
}

function workflowTaskStatus(shipmentStatus: string, stepIndex: number) {
  const completedSteps = (() => {
    switch (shipmentStatus) {
      case "Hoàn thành":
        return SHIPMENT_TASK_STEPS.length;
      case "Thông quan":
      case "Giải phóng hàng":
        return 3;
      case "Đưa hàng về bảo quản":
        return 2;
      default:
        return 0;
    }
  })();

  if (stepIndex < completedSteps) return "DONE" as const;
  if (shipmentStatus !== "Hủy" && stepIndex === completedSteps && completedSteps < SHIPMENT_TASK_STEPS.length) {
    return "IN_PROGRESS" as const;
  }
  return "TODO" as const;
}

/**
 * Adds missing fixed workflow steps to every historical shipment in one bulk transaction.
 * Existing task rows are preserved, including manual assignee/status changes.
 */
export function backfillShipmentWorkflowTasks({
  createdByUserId,
}: {
  createdByUserId: string;
}): Promise<WorkflowBackfillResult> {
  if (activeBackfill) return activeBackfill;
  activeBackfill = runWorkflowBackfill(createdByUserId).finally(() => {
    activeBackfill = null;
  });
  return activeBackfill;
}

async function runWorkflowBackfill(createdByUserId: string): Promise<WorkflowBackfillResult> {
  const shipments = await prisma.shipment.findMany({
    select: {
      id: true,
      shipmentCode: true,
      declarationNo: true,
      status: true,
      customer: {
        select: {
          assignedUser: { select: { id: true, isActive: true } },
        },
      },
      tasks: {
        where: { title: { in: [...SHIPMENT_TASK_STEPS] } },
        select: { title: true },
      },
    },
  });

  const stepAssigneeOverrides = await resolveStepAssigneeOverrides();
  const taskRows = shipments.flatMap((shipment) => {
    const existingTitles = new Set(shipment.tasks.map((task) => task.title));
    const assignedUser = shipment.customer?.assignedUser;
    const assignedToUserId = assignedUser?.isActive ? assignedUser.id : createdByUserId;
    return SHIPMENT_TASK_STEPS.flatMap((title, stepIndex) =>
      existingTitles.has(title)
        ? []
        : [{
            title,
            description: `Bước ${stepIndex + 1}/${SHIPMENT_TASK_STEPS.length} của lô TK ${shipment.declarationNo || shipment.shipmentCode}.`,
            status: workflowTaskStatus(shipment.status, stepIndex),
            assignedToUserId: stepAssigneeOverrides.get(title) ?? assignedToUserId,
            relatedShipmentId: shipment.id,
            createdByUserId,
          }]
    );
  });

  if (taskRows.length === 0) return { shipmentsUpdated: 0, tasksCreated: 0 };

  const affectedShipmentIds = new Set(taskRows.map((task) => task.relatedShipmentId));
  const taskRowKeys = new Set(taskRows.map((task) => `${task.relatedShipmentId}:${task.title}`));
  const assignmentCounts = new Map<string, number>();
  for (const task of taskRows) {
    if (task.assignedToUserId === createdByUserId) continue;
    assignmentCounts.set(task.assignedToUserId, (assignmentCounts.get(task.assignedToUserId) ?? 0) + 1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.task.createMany({ data: taskRows });

    const startedTasks = (await tx.task.findMany({
      where: {
        relatedShipmentId: { in: [...affectedShipmentIds] },
        title: { in: [...SHIPMENT_TASK_STEPS] },
        status: { not: "TODO" },
        statusLogs: { none: {} },
      },
      select: { id: true, title: true, status: true, relatedShipmentId: true },
    })).filter(
      (task) => task.relatedShipmentId && taskRowKeys.has(`${task.relatedShipmentId}:${task.title}`)
    );
    if (startedTasks.length > 0) {
      await tx.taskStatusLog.createMany({
        data: startedTasks.map((task) => ({
          taskId: task.id,
          actorUserId: createdByUserId,
          fromStatus: "TODO" as const,
          toStatus: task.status,
        })),
      });
    }

    if (assignmentCounts.size > 0) {
      await tx.notification.createMany({
        data: [...assignmentCounts].map(([userId, taskCount]) => ({
          userId,
          type: "TASK_ASSIGNED" as const,
          message: `Bạn được giao ${taskCount} bước tiến trình của các lô hàng cũ.`,
        })),
      });
    }
  });

  return {
    shipmentsUpdated: affectedShipmentIds.size,
    tasksCreated: taskRows.length,
  };
}

/**
 * Creates any missing fixed workflow tasks for a shipment.
 *
 * Assignment priority:
 * 1. The active user assigned to the shipment's linked customer.
 * 2. The user who created/imported the shipment.
 *
 * Existing tasks are never overwritten, so a manager can still reassign an individual step by hand.
 */
export async function ensureShipmentWorkflowTasks({
  shipmentId,
  createdByUserId,
}: {
  shipmentId: string;
  createdByUserId: string;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentCode: true,
      declarationNo: true,
      status: true,
      customer: {
        select: {
          assignedUser: { select: { id: true, isActive: true } },
        },
      },
      tasks: {
        where: { title: { in: [...SHIPMENT_TASK_STEPS] } },
        select: { title: true },
      },
    },
  });
  if (!shipment) return 0;

  const existingTitles = new Set(shipment.tasks.map((task) => task.title));
  const missingSteps = SHIPMENT_TASK_STEPS.filter((title) => !existingTitles.has(title));
  if (missingSteps.length === 0) return 0;

  const stepAssigneeOverrides = await resolveStepAssigneeOverrides();
  const customerAssignee = shipment.customer?.assignedUser;
  const assignedToUserId = customerAssignee?.isActive ? customerAssignee.id : createdByUserId;

  return prisma.$transaction(async (tx) => {
    let createdCount = 0;
    for (const title of missingSteps) {
      const stepIndex = SHIPMENT_TASK_STEPS.indexOf(title);
      const status = workflowTaskStatus(shipment.status, stepIndex);
      const task = await tx.task.create({
        data: {
          title,
          description: `Bước ${stepIndex + 1}/${SHIPMENT_TASK_STEPS.length} của lô TK ${shipment.declarationNo || shipment.shipmentCode}.`,
          status,
          assignedToUserId: stepAssigneeOverrides.get(title) ?? assignedToUserId,
          relatedShipmentId: shipment.id,
          createdByUserId,
        },
      });
      createdCount += 1;

      if (status !== "TODO") {
        await tx.taskStatusLog.create({
          data: {
            taskId: task.id,
            actorUserId: createdByUserId,
            fromStatus: "TODO",
            toStatus: status,
          },
        });
      }

    }
    return createdCount;
  });
}

/**
 * When a customer manager is changed, move every unfinished fixed workflow step to the new manager.
 * Ad-hoc tasks and completed workflow steps keep their existing assignee/history.
 */
export async function reassignOpenShipmentWorkflowTasks({
  customerId,
  assignedToUserId,
  actorUserId,
}: {
  customerId: string;
  assignedToUserId: string;
  actorUserId: string;
}) {
  // Steps with a designated company-wide assignee stay with that person when the
  // customer's manager changes; only the remaining steps follow the new manager.
  const stepAssigneeOverrides = await resolveStepAssigneeOverrides();
  const reassignableTitles = SHIPMENT_TASK_STEPS.filter((title) => !stepAssigneeOverrides.has(title));

  const tasks = await prisma.task.findMany({
    where: {
      relatedShipment: { customerId },
      title: { in: reassignableTitles },
      status: { not: "DONE" },
      assignedToUserId: { not: assignedToUserId },
    },
    select: {
      id: true,
      title: true,
      relatedShipmentId: true,
      relatedShipment: {
        select: {
          declarationNo: true,
          customerName: true,
          goodsName: true,
        },
      },
    },
  });
  if (tasks.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.task.updateMany({
      where: { id: { in: tasks.map((task) => task.id) } },
      data: { assignedToUserId },
    });
  });

  if (assignedToUserId !== actorUserId) {
    const shipments = new Map(
      tasks.flatMap((task) => task.relatedShipmentId && task.relatedShipment
        ? [[task.relatedShipmentId, task.relatedShipment] as const]
        : [])
    );
    await Promise.all(
      [...shipments].map(([shipmentId, shipment]) =>
        notifyShipmentAssigned({
          recipientUserIds: [assignedToUserId],
          shipmentId,
          declarationNo: shipment.declarationNo,
          customerName: shipment.customerName,
          goodsName: shipment.goodsName,
        })
      )
    );
  }
}
