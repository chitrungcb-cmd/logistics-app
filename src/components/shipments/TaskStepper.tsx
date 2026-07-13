"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 15000;

type StepTask = {
  id: string;
  status: string;
  updatedAt: string;
  assignedTo: { id: string; name: string };
} | null;

type Step = { title: string; task: StepTask };

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
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    function load() {
      fetch(`/api/shipments/${shipmentId}/task-steps`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) setSteps(json.data);
        })
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [shipmentId]);

  if (steps.length === 0) return null;

  return (
    <div className="flex items-start">
      {steps.map((step, index) => {
        const status = step.task?.status ?? "TODO";
        const isDone = status === "DONE";

        return (
          <div key={step.title} className={`flex items-start ${index < steps.length - 1 ? "flex-1" : ""}`}>
            <div
              className="relative flex flex-col items-center"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex((prev) => (prev === index ? null : prev))}
            >
              <button
                type="button"
                onClick={() => step.task && router.push(`/tasks/${step.task.id}`)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition ${circleClassFor(
                  status
                )} ${step.task ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
              >
                {status === "DONE" ? "✓" : status === "IN_PROGRESS" ? "⏳" : index + 1}
              </button>
              <span className="mt-1 max-w-[84px] text-center text-[11px] leading-tight text-gray-600">
                {step.title}
              </span>

              {hoveredIndex === index && (
                <div className="absolute top-11 z-10 w-48 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-lg">
                  <p className="font-medium text-gray-900">{step.title}</p>
                  {step.task ? (
                    <>
                      <p className="mt-0.5 text-gray-500">Người phụ trách: {step.task.assignedTo.name}</p>
                      <p className="text-gray-400">
                        Cập nhật: {new Date(step.task.updatedAt).toLocaleString("vi-VN")}
                      </p>
                    </>
                  ) : (
                    <p className="mt-0.5 text-gray-400">Chưa tạo nhiệm vụ này.</p>
                  )}
                </div>
              )}
            </div>

            {index < steps.length - 1 && (
              <div className={`mt-4 h-0.5 flex-1 ${isDone ? "bg-green-600" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
