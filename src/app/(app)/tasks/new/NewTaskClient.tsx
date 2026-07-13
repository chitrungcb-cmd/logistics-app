"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TASK_STATUS_LABELS, TASK_STATUS_OPTIONS } from "@/lib/task-constants";

type UserOption = { id: string; name: string; email: string; role: string };
type ShipmentOption = { id: string; shipmentCode: string; customerName: string; declarationNo: string | null };

export default function NewTaskClient() {
  const router = useRouter();

  const [users, setUsers] = useState<UserOption[]>([]);
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [shipmentQuery, setShipmentQuery] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    assignedToUserId: "",
    dueDate: "",
    status: TASK_STATUS_OPTIONS[0] as string,
    relatedShipmentId: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => json.success && setUsers(json.data));
    fetch("/api/shipments")
      .then((res) => res.json())
      .then((json) => json.success && setShipments(json.data));
  }, []);

  const shipmentMatches = useMemo(() => {
    const query = shipmentQuery.trim().toLowerCase();
    if (!query) return [];
    return shipments
      .filter(
        (s) =>
          s.customerName.toLowerCase().includes(query) ||
          (s.declarationNo ?? "").toLowerCase().includes(query)
      )
      .slice(0, 8);
  }, [shipments, shipmentQuery]);

  const selectedShipment = shipments.find((s) => s.id === form.relatedShipmentId);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.title.trim() || !form.assignedToUserId) {
      setError("Vui lòng nhập tiêu đề và chọn người được giao việc.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          relatedShipmentId: form.relatedShipmentId || null,
          dueDate: form.dueDate || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể tạo nhiệm vụ.");
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/tasks" className="text-sm text-blue-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Giao việc mới</h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-5 rounded-lg border border-gray-200 bg-white p-6">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Tiêu đề *</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="input"
            required
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Mô tả</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="input"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">Giao cho *</span>
          <select
            value={form.assignedToUserId}
            onChange={(e) => setForm({ ...form, assignedToUserId: e.target.value })}
            className="input"
            required
          >
            <option value="">-- Chọn người --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Hạn hoàn thành</span>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Trạng thái</span>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="input"
            >
              {TASK_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {TASK_STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="relative">
          <span className="mb-1 block text-sm font-medium text-gray-700">Lô hàng liên quan (tùy chọn)</span>
          {selectedShipment ? (
            <div className="flex items-center justify-between rounded-md border border-gray-300 px-3 py-2 text-sm">
              <span>
                {selectedShipment.customerName} — {selectedShipment.declarationNo || selectedShipment.shipmentCode}
              </span>
              <button
                type="button"
                onClick={() => setForm({ ...form, relatedShipmentId: "" })}
                className="text-gray-400 hover:text-gray-600"
              >
                Xóa
              </button>
            </div>
          ) : (
            <>
              <input
                value={shipmentQuery}
                onChange={(e) => setShipmentQuery(e.target.value)}
                placeholder="Tìm theo khách hàng hoặc số tờ khai..."
                className="input"
              />
              {shipmentMatches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-md">
                  {shipmentMatches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setForm({ ...form, relatedShipmentId: s.id });
                        setShipmentQuery("");
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      {s.customerName} — {s.declarationNo || s.shipmentCode}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/tasks"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Hủy
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? "Đang lưu..." : "Giao việc"}
          </button>
        </div>
      </form>
    </div>
  );
}
