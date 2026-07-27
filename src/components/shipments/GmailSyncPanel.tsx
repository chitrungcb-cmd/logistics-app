"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SyncSummary = {
  scanned: number;
  newlyFound: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  invoicesScanned: number;
  invoicesCreated: number;
  invoicesMatched: number;
  invoicesUnmatched: number;
  invoicesNeedsReview: number;
  invoiceErrors: number;
  inProgress?: boolean;
};

export default function GmailSyncPanel({ onSynced }: { onSynced?: () => void }) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [serverSyncConfigured, setServerSyncConfigured] = useState(false);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const isSyncingRef = useRef(false);
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
          setLastSyncedAt(json.data.lastSyncedAt ? new Date(json.data.lastSyncedAt) : null);
          setServerSyncConfigured(Boolean(json.data.serverSyncConfigured));
          setReconnectRequired(Boolean(json.data.reconnectRequired));
          setConnectionError(json.data.connectionError || null);
        }
      } catch {
        setIsConnected(false);
      }
    }

    loadStatus();
  }, []);

  const runSync = useCallback(async () => {
    if (isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST", cache: "no-store" });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok || !json.success) {
        throw new Error(json?.error || "Đồng bộ email thất bại.");
      }
      setSummary(json.data);
      setLastSyncedAt(new Date());
      if (!json.data.inProgress && (json.data.created > 0 || json.data.updated > 0 || json.data.invoicesCreated > 0)) {
        onSynced?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [onSynced]);

  if (isConnected === null) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Đồng bộ dữ liệu từ Email</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {isConnected
              ? `Đã kết nối Gmail: ${email} · tự đọc tờ khai và hóa đơn đầu vào/đầu ra`
              : reconnectRequired
                ? `Gmail ${email || ""} cần được kết nối lại để tiếp tục tự động cập nhật.`
                : "Chưa kết nối Gmail — tự động tạo/cập nhật lô hàng và đối chiếu hóa đơn đính kèm trong email."}
          </p>
          {connectionError && <p className="mt-1 text-xs font-medium text-red-600">{connectionError}</p>}
        </div>
        {isConnected ? (
          <div className="flex items-center gap-3 text-right">
            <div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${serverSyncConfigured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {serverSyncConfigured ? "✓ Tác vụ máy chủ" : "Chưa cấu hình tác vụ máy chủ"}
              </span>
              <p className="mt-1 text-[11px] text-gray-400">
                {lastSyncedAt
                  ? `Dữ liệu xử lý gần nhất: ${lastSyncedAt.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
                  : serverSyncConfigured ? "Máy chủ sẽ tự kiểm tra theo lịch" : "Cần thêm CRON_SECRET và lịch chạy"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runSync()}
              disabled={isSyncing}
              className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSyncing ? "Đang đồng bộ..." : "Đồng bộ ngay"}
            </button>
          </div>
        ) : (
          <a
            href="/api/gmail/auth"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {reconnectRequired ? "Kết nối lại Gmail" : "Kết nối Gmail"}
          </a>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {summary && (
        <p className="mt-3 text-sm text-gray-600">
          {summary.inProgress
            ? "Một tiến trình đồng bộ khác đang chạy; hệ thống sẽ tự kiểm tra lại."
            : `Tờ khai: ${summary.newlyFound === 0 ? "không có email mới" : `tạo ${summary.created}, cập nhật ${summary.updated}`}. Hóa đơn: ${summary.invoicesCreated === 0 ? "không có file mới" : `nhận ${summary.invoicesCreated}, đã khớp ${summary.invoicesMatched}, chờ đối chiếu ${summary.invoicesUnmatched + summary.invoicesNeedsReview}`}${summary.errors + summary.invoiceErrors > 0 ? ` · lỗi ${summary.errors + summary.invoiceErrors}` : ""}.`}
        </p>
      )}
    </div>
  );
}
