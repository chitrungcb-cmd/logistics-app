"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
        }
      } catch {
        setIsConnected(false);
      }
    }

    loadStatus();
  }, []);

  const runAutomaticSync = useCallback(async () => {
    if (isSyncingRef.current || document.visibilityState === "hidden") return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/gmail/sync", { method: "POST", cache: "no-store" });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok || !json.success) {
        throw new Error(json?.error || "Đồng bộ tự động thất bại.");
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

  useEffect(() => {
    if (!isConnected) return;

    const initialSync = window.setTimeout(() => void runAutomaticSync(), 0);
    const interval = window.setInterval(() => void runAutomaticSync(), AUTO_SYNC_INTERVAL_MS);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void runAutomaticSync();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isConnected, runAutomaticSync]);

  if (isConnected === null) return null;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Đồng bộ dữ liệu từ Email</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {isConnected
              ? `Đã kết nối Gmail: ${email} · tự đọc tờ khai và hóa đơn đầu vào`
              : "Chưa kết nối Gmail — tự động tạo/cập nhật lô hàng và đối chiếu hóa đơn đính kèm trong email."}
          </p>
        </div>
        {isConnected ? (
          <div className="text-right">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${isSyncing ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
              {isSyncing ? "Đang tự động đồng bộ..." : "✓ Tự động đồng bộ"}
            </span>
            <p className="mt-1 text-[11px] text-gray-400">
              {lastSyncedAt
                ? `Lần kiểm tra gần nhất: ${lastSyncedAt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`
                : "Tự kiểm tra mỗi 5 phút"}
            </p>
          </div>
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
          {summary.inProgress
            ? "Một tiến trình đồng bộ khác đang chạy; hệ thống sẽ tự kiểm tra lại."
            : `Tờ khai: ${summary.newlyFound === 0 ? "không có email mới" : `tạo ${summary.created}, cập nhật ${summary.updated}`}. Hóa đơn: ${summary.invoicesCreated === 0 ? "không có file mới" : `nhận ${summary.invoicesCreated}, đã khớp ${summary.invoicesMatched}, chờ đối chiếu ${summary.invoicesUnmatched + summary.invoicesNeedsReview}`}${summary.errors + summary.invoiceErrors > 0 ? ` · lỗi ${summary.errors + summary.invoiceErrors}` : ""}.`}
        </p>
      )}
    </div>
  );
}
