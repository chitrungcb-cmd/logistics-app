"use client";

import { useEffect, useState } from "react";

type SyncSummary = {
  scanned: number;
  newlyFound: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
};

export default function GmailSyncPanel() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("gmail_error")
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("gmail_connected") || params.has("gmail_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }

    async function loadStatus() {
      try {
        const res = await fetch("/api/gmail/status");
        const json = await res.json();
        if (res.ok && json.success) {
          setIsConnected(json.data.connected);
          setEmail(json.data.email);
        }
      } catch {
        setIsConnected(false);
      }
    }

    loadStatus();
  }, []);

  async function handleSync() {
    setIsSyncing(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Đồng bộ thất bại.");
      }
      setSummary(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsSyncing(false);
    }
  }

  if (isConnected === null) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Đồng bộ tờ khai từ Email</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {isConnected
              ? `Đã kết nối Gmail: ${email}`
              : "Chưa kết nối Gmail — tự động tạo/cập nhật lô hàng từ file tờ khai đính kèm trong email."}
          </p>
        </div>
        {isConnected ? (
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSyncing ? "Đang đồng bộ..." : "Đồng bộ ngay"}
          </button>
        ) : (
          <a
            href="/api/gmail/auth"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Kết nối Gmail
          </a>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {summary && (
        <p className="mt-3 text-sm text-gray-600">
          Đã quét {summary.scanned} email ({summary.newlyFound} email mới): tạo mới {summary.created}, cập
          nhật {summary.updated}, bỏ qua {summary.skipped}
          {summary.errors > 0 ? `, lỗi ${summary.errors}` : ""}.
          {summary.newlyFound >= 150 && " Vẫn còn email chưa xử lý — bấm Đồng bộ ngay lần nữa."}
        </p>
      )}
    </div>
  );
}
