"use client";

import { useEffect, useState } from "react";

type UserOption = { id: string; name: string; email: string; role: string };
type ShipmentOption = { id: string; shipmentCode: string; goodsName: string | null; customerName: string };

export default function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [name, setName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [relatedShipmentId, setRelatedShipmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setUsers(json.data);
      })
      .catch(() => {});
    fetch("/api/shipments")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setShipments(json.data);
      })
      .catch(() => {});
  }, []);

  function toggleMember(userId: string) {
    setSelectedMemberIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Vui lòng nhập tên nhóm.");
      return;
    }
    if (selectedMemberIds.length === 0) {
      setError("Vui lòng chọn ít nhất một thành viên.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "GROUP",
          name: name.trim(),
          memberIds: selectedMemberIds,
          relatedShipmentId: relatedShipmentId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể tạo nhóm.");
      onCreated(json.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-gray-900">Tạo nhóm mới</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Tên nhóm</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700">Thành viên</span>
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selectedMemberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  {u.name} <span className="text-xs text-gray-400">({u.email})</span>
                </label>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Liên kết lô hàng (tùy chọn)</span>
            <select
              value={relatedShipmentId}
              onChange={(e) => setRelatedShipmentId(e.target.value)}
              className="input"
            >
              <option value="">-- Không liên kết --</option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.goodsName || "Chưa có tên hàng"} - {s.shipmentCode} - {s.customerName}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Đang tạo..." : "Tạo nhóm"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Hủy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
