"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { readApiResponse } from "@/lib/client-api";
import { SHIPMENT_TASK_STEPS, TASK_STATUS_LABELS } from "@/lib/task-constants";

const TaskDetailModal = dynamic(() => import("@/components/tasks/TaskDetailModal"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
      <div className="rounded-xl bg-white px-6 py-5 text-sm text-gray-500 shadow-2xl">
        Đang mở nhiệm vụ...
      </div>
    </div>
  ),
});

const POLL_MS = 30000;

type StepTask = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  assignedTo: { id: string; name: string };
  statusLogs: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    createdAt: string;
    actor: { id: string; name: string };
  }>;
} | null;

type Step = { title: string; task: StepTask };

type TaskStepsResponse = {
  success: boolean;
  data?: Step[];
  error?: string;
};

function circleClassFor(status: string) {
  switch (status) {
    case "DONE":
      return "border-green-600 bg-green-600 text-white";
    case "IN_PROGRESS":
      return "border-orange-400 bg-orange-100 text-orange-700";
    default:
      return "border-gray-300 bg-gray-100 text-gray-400";
  }
}

export default function TaskStepper({ shipmentId }: { shipmentId: string }) {
  const [steps, setSteps] = useState<Step[]>(() =>
    SHIPMENT_TASK_STEPS.map((title) => ({ title, task: null }))
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    function load() {
      fetch(`/api/shipments/${shipmentId}/task-steps`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
        .then((response) =>
          readApiResponse<TaskStepsResponse>(response, "Không thể tải tiến trình.")
        )
        .then((json) => {
          if (!json.success) throw new Error(json.error || "Không thể tải tiến trình.");
          if (!json.data) throw new Error("Máy chủ không trả về dữ liệu tiến trình.");
          setSteps(json.data);
          setLoadError(null);
        })
        .catch((error) => setLoadError(error instanceof Error ? error.message : "Không thể tải tiến trình."));
    }
    load();
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    const interval = setInterval(loadWhenVisible, POLL_MS);
    window.addEventListener("focus", loadWhenVisible);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", loadWhenVisible);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, [shipmentId, refreshVersion]);

  const selectedStep = selectedIndex === null ? null : steps[selectedIndex];

  return (
    <div>
      {loadError && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ {loadError} Hệ thống sẽ tự thử lại.
        </p>
      )}
      <div className="flex items-start">
      {steps.map((step, index) => {
        const status = step.task?.status ?? "TODO";
        const isDone = status === "DONE";

        return (
          <div key={step.title} className={`flex items-start ${index < steps.length - 1 ? "flex-1" : ""}`}>
            <div
              className="relative flex flex-col items-center"
            >
              <button
                type="button"
                onClick={() => setSelectedIndex((current) => (current === index ? null : index))}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${circleClassFor(
                  status
                )} cursor-pointer hover:opacity-80 ${selectedIndex === index ? "ring-4 ring-blue-100" : ""}`}
              >
                {status === "DONE" ? "✓" : status === "IN_PROGRESS" ? "⏳" : index + 1}
              </button>
              <span className="mt-1 max-w-[84px] text-center text-[11px] leading-tight text-gray-600">
                {step.title}
              </span>
            </div>

            {index < steps.length - 1 && (
              <div className={`mt-4 h-0.5 flex-1 ${isDone ? "bg-green-600" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
      </div>

      {selectedStep && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">{selectedStep.title}</p>
              {selectedStep.task ? (
                <>
                  <p className="mt-1 text-gray-600">Người phụ trách: <span className="font-medium">{selectedStep.task.assignedTo.name}</span></p>
                  <p className="text-gray-500">Trạng thái: {TASK_STATUS_LABELS[selectedStep.task.status] ?? selectedStep.task.status}</p>
                </>
              ) : <p className="mt-1 text-gray-500">Chưa tạo nhiệm vụ và chưa có người phụ trách.</p>}
            </div>
            {selectedStep.task && (
              <button
                type="button"
                onClick={() => setOpenTaskId(selectedStep.task?.id ?? null)}
                className="text-blue-600 hover:underline"
              >
                Mở nhiệm vụ →
              </button>
            )}
          </div>
          {selectedStep.task && (
            <div className="mt-3 border-t border-blue-100 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Lịch sử tiến trình</p>
              <ul className="space-y-2">
                {selectedStep.task.statusLogs.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-gray-700">
                      {TASK_STATUS_LABELS[log.fromStatus] ?? log.fromStatus} → <span className="font-medium">{TASK_STATUS_LABELS[log.toStatus] ?? log.toStatus}</span> · {log.actor.name}
                    </span>
                    <span className="text-gray-400">{new Date(log.createdAt).toLocaleString("vi-VN")}</span>
                  </li>
                ))}
                {selectedStep.task.statusLogs.length === 0 && (
                  <li className="text-xs text-gray-400">Chưa có lần thay đổi trạng thái nào được ghi nhận.</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
          onTaskUpdated={() => setRefreshVersion((current) => current + 1)}
        />
      )}
    </div>
  );
}
