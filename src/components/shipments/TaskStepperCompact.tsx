"use client";

import { SHIPMENT_TASK_STEPS } from "@/lib/task-constants";

const DOT_CLASS: Record<string, string> = {
  DONE: "bg-green-600",
  IN_PROGRESS: "bg-orange-400",
};

const STATUS_LABEL: Record<string, string> = {
  DONE: "Hoàn thành",
  IN_PROGRESS: "Đang thực hiện",
  TODO: "Chưa bắt đầu",
};

/** A row of 6 small dots — one per SHIPMENT_TASK_STEPS entry — for the /shipments list, where a full
 * TaskStepper per row would mean hundreds of extra API calls. `statuses[i]` is null when that step's
 * task hasn't been created yet, treated the same as "TODO" visually. */
export default function TaskStepperCompact({ statuses }: { statuses: (string | null)[] }) {
  return (
    <div className="flex w-max items-center gap-1">
      {SHIPMENT_TASK_STEPS.map((title, i) => {
        const status = statuses[i] ?? "TODO";
        return (
          <span
            key={title}
            title={`${title}: ${STATUS_LABEL[status] ?? status}`}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[status] ?? "bg-gray-300"}`}
          />
        );
      })}
    </div>
  );
}
