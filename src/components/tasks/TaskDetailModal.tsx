"use client";

import { useEffect } from "react";
import TaskDetailClient from "@/app/(app)/tasks/[id]/TaskDetailClient";

export default function TaskDetailModal({
  taskId,
  onClose,
  onTaskUpdated,
}: {
  taskId: string;
  onClose: () => void;
  onTaskUpdated: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-modal-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-gray-50 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Nhiệm vụ lô hàng</p>
            <h2 id="task-detail-modal-title" className="mt-1 text-xl font-semibold text-gray-900">
              Chi tiết nhiệm vụ
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Đóng cửa sổ chi tiết nhiệm vụ"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskDetailClient
            taskId={taskId}
            canManage={false}
            embedded
            onTaskUpdated={onTaskUpdated}
          />
        </div>
      </div>
    </div>
  );
}
