"use client";

import { useEffect, useState } from "react";
import { COST_CATEGORY_ICON, COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";

type CostRow = {
  id: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  invoiceNumber: string | null;
  attachmentUrl: string | null;
  note: string | null;
};

type AuditLogEntry = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  user: { id: string; name: string };
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

// Aggregates ACROSS every ShipmentCost row for one shipment — deliberately re-fetches fresh from
// /api/costs?shipmentId=X (ignoring whatever filters are active on the /costs list) so this always
// reflects the shipment's complete cost history, not just whatever happens to be on-screen.
// `invoiceNumber` is the specific row's Số hóa đơn that the caller clicked "Xem" on (shown as the
// green badge) — the comparison table below it still aggregates every category for the whole shipment.
export default function CostDetailPanel({
  shipmentId,
  invoiceNumber,
  onClose,
}: {
  shipmentId: string;
  invoiceNumber: string | null;
  onClose: () => void;
}) {
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/costs?shipmentId=${shipmentId}`).then((res) => res.json()),
      fetch(`/api/costs/audit-log?shipmentId=${shipmentId}`).then((res) => res.json()),
    ])
      .then(([costsJson, auditJson]) => {
        if (!costsJson.success) throw new Error(costsJson.error || "Không thể tải chi tiết chi phí.");
        setCosts(costsJson.data);
        if (auditJson.success) setAuditLog(auditJson.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [shipmentId]);

  // All 9 categories are always listed, even with no data (0 đ) — this is a comparison grid across
  // the whole cost taxonomy, not just the categories that happen to have rows yet.
  const rows = COST_CATEGORY_OPTIONS.map((category) => {
    const matching = costs.filter((c) => c.category === category);
    const chiPhiCoHoaDon = matching
      .filter((c) => c.invoiceNumber && c.invoiceNumber.trim())
      .reduce((sum, c) => sum + c.costPrice, 0);
    const baoGia = matching.reduce((sum, c) => sum + c.sellPrice, 0);
    return { category, chiPhiCoHoaDon, baoGia };
  });

  const totalChiPhiCoHoaDon = rows.reduce((sum, r) => sum + r.chiPhiCoHoaDon, 0);
  const totalBaoGia = rows.reduce((sum, r) => sum + r.baoGia, 0);
  const caNhan = totalBaoGia - totalChiPhiCoHoaDon;

  const attachments = costs
    .filter((c) => c.attachmentUrl)
    .map((c) => ({ url: c.attachmentUrl!, name: c.attachmentUrl!.split("/").pop() || "file" }));
  const combinedNotes = costs.map((c) => c.note).filter((n): n is string => !!n && n.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Chi tiết chi phí</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                {invoiceNumber || "—"}
              </span>
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                Cá nhân
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 px-5 py-4">
          {isLoading && <p className="text-center text-gray-400">Đang tải...</p>}
          {error && <p className="text-center text-red-600">{error}</p>}

          {!isLoading && !error && (
            <>
              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">So sánh chi phí / báo giá</h4>
                <div className="overflow-x-auto rounded-md border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Hạng mục</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Chi phí (có hóa đơn)</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Báo giá</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((row) => (
                        <tr key={row.category}>
                          <td className="px-3 py-2 text-gray-900">
                            {COST_CATEGORY_ICON[row.category]} {COST_CATEGORY_LABELS[row.category] ?? row.category}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{formatVnd(row.chiPhiCoHoaDon)}</td>
                          <td className="px-3 py-2 text-gray-600">{formatVnd(row.baoGia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
                  <p className="text-sm font-medium text-blue-700">Tổng chi phí có hóa đơn</p>
                  <p className="text-base font-semibold text-blue-900">{formatVnd(totalChiPhiCoHoaDon)}</p>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-3">
                  <p className="text-sm font-medium text-blue-700">Tổng báo giá</p>
                  <p className="text-base font-semibold text-blue-900">{formatVnd(totalBaoGia)}</p>
                </div>
              </section>

              <section className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-orange-800">Cá nhân</p>
                  <p className="text-xl font-semibold text-orange-900">{formatVnd(caNhan)}</p>
                </div>
                <p className="mt-1 text-xs text-orange-700">= Tổng báo giá − Tổng chi phí có hóa đơn</p>
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">📎 Chứng từ đính kèm</h4>
                {attachments.length === 0 ? (
                  <p className="text-sm text-gray-400">Chưa có chứng từ nào.</p>
                ) : (
                  <ul className="space-y-1">
                    {attachments.map((att, i) => (
                      <li key={i} className="flex items-center justify-between text-sm">
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
                        >
                          📎 {att.name}
                        </a>
                        <a href={att.url} download className="text-gray-500 hover:text-gray-700" aria-label="Tải về">
                          ⬇
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">📝 Ghi chú</h4>
                {combinedNotes.length === 0 ? (
                  <p className="text-sm text-gray-400">Không có ghi chú.</p>
                ) : (
                  <p className="text-sm text-gray-600">{combinedNotes.join(" · ")}</p>
                )}
              </section>

              <section>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Lịch sử thao tác</h4>
                {auditLog.length === 0 ? (
                  <p className="text-sm text-gray-400">Chưa có thao tác nào.</p>
                ) : (
                  <ul className="space-y-2">
                    {auditLog.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-gray-200 pl-3 text-sm">
                        <p className="text-gray-700">{entry.detail}</p>
                        <p className="text-xs text-gray-400">
                          {entry.user.name} · {new Date(entry.createdAt).toLocaleString("vi-VN")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
