"use client";

import { useEffect, useMemo, useState } from "react";

type UserOption = { id: string; name: string; email: string; role: string };

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Quản trị",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Hiện trường",
};

export default function NewDirectMessageModal({
  currentUserId,
  onClose,
  onCreated,
}: {
  currentUserId: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creatingUserId, setCreatingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setUsers(json.data);
      })
      .catch(() => {});
  }, []);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users
      .filter((u) => u.id !== currentUserId)
      .filter(
        (u) =>
          !query ||
          u.name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query)
      );
  }, [users, search, currentUserId]);

  async function startConversation(otherUserId: string) {
    if (creatingUserId) return;
    setError(null);
    setCreatingUserId(otherUserId);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DIRECT", otherUserId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể mở cuộc trò chuyện.");
      onCreated(json.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      setCreatingUserId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-6 pb-4 pt-6">
          <h3 className="text-base font-semibold text-gray-900">Nhắn tin riêng</h3>
          <p className="mt-1 text-sm text-gray-500">Chọn một người để bắt đầu trò chuyện 1–1.</p>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên hoặc email..."
            className="input mt-3"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {visibleUsers.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Không tìm thấy người phù hợp.</p>
          ) : (
            visibleUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={Boolean(creatingUserId)}
                onClick={() => startConversation(u.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-4 py-2.5 text-left hover:bg-gray-50 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{u.name}</span>
                  <span className="block truncate text-xs text-gray-400">{u.email}</span>
                </span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {creatingUserId === u.id ? "Đang mở..." : ROLE_LABELS[u.role] ?? u.role}
                </span>
              </button>
            ))
          )}
        </div>

        {error && <p className="px-6 pb-2 text-sm text-red-600">{error}</p>}

        <div className="border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
