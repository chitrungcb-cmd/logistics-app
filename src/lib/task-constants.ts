export const TASK_STATUS_OPTIONS = ["TODO", "IN_PROGRESS", "DONE"] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  TODO: "Chưa bắt đầu",
  IN_PROGRESS: "Đang thực hiện",
  DONE: "Hoàn thành",
};

export function taskStatusBadgeClass(status: string) {
  switch (status) {
    case "DONE":
      return "bg-green-100 text-green-700";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

// The fixed 6-step workflow every shipment goes through, shown as a stepper on the shipment detail
// page (TaskStepper.tsx). A step is "done"/"in progress" purely by matching Task.title exactly
// against this list for a Task with relatedShipmentId = that shipment — there's no dedicated column
// marking a Task as one of these steps, so titles must match exactly for the stepper to pick it up.
// Doesn't apply to any other ad-hoc task a user creates for a shipment.
export const SHIPMENT_TASK_STEPS = [
  "Khai 119",
  "Khai cửa khẩu số",
  "Làm hồ sơ tiếp nhận",
  "Xuất hóa đơn VAT",
  "Gửi hồ sơ thanh toán",
  "Lưu trữ đủ bộ hồ sơ",
] as const;

/**
 * The Task table stores both fixed shipment workflow steps and ad-hoc assignments. Until those are
 * split into separate tables, a task linked to a shipment and carrying one of the six fixed titles
 * is treated as workflow. This also covers historical rows created before descriptions were added.
 */
export function adHocTaskWhere() {
  return {
    NOT: {
      relatedShipmentId: { not: null },
      title: { in: [...SHIPMENT_TASK_STEPS] },
    },
  };
}
