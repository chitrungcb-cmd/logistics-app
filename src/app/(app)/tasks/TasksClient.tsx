"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Badge from "@/components/shipments/Badge";
import PaginationControls from "@/components/PaginationControls";
import { TASK_STATUS_LABELS, taskStatusBadgeClass } from "@/lib/task-constants";
import type { PaginationMeta } from "@/lib/pagination";

const PAGE_SIZE = 50;
const EMPTY_PAGINATION: PaginationMeta = { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 };

type Task = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  assignedTo: { id: string; name: string };
  createdBy: { id: string; name: string };
  relatedShipment: { id: string; customerName: string; declarationNo: string | null } | null;
};

export default function TasksClient({ canManage }: { canManage: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta>(EMPTY_PAGINATION);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tasks?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error);
        setTasks(json.data.items);
        setPagination(json.data.pagination);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Nhiệm vụ</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canManage
              ? "Các công việc được giao ngoài tiến trình xử lý lô hàng."
              : "Các công việc ngoài tiến trình được giao cho bạn."}
          </p>
        </div>
        {canManage && (
          <Link
            href="/tasks/new"
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Giao việc mới
          </Link>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tiêu đề</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Giao cho</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Hạn hoàn thành</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Lô hàng liên quan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Trạng thái</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">Đang tải...</td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-600">{error}</td>
              </tr>
            )}
            {!isLoading && !error && tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400">Chưa có công việc nào ngoài tiến trình lô hàng.</td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              tasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{task.title}</td>
                  <td className="px-4 py-3 text-gray-600">{task.assignedTo.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString("vi-VN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {task.relatedShipment
                      ? [
                          task.relatedShipment.customerName,
                          task.relatedShipment.declarationNo ? `TK ${task.relatedShipment.declarationNo}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      label={TASK_STATUS_LABELS[task.status] ?? task.status}
                      className={taskStatusBadgeClass(task.status)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/tasks/${task.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                      Xem chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={pagination} onPageChange={(nextPage) => { setIsLoading(true); setPage(nextPage); }} />
    </div>
  );
}
