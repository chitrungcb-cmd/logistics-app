"use client";

import { useEffect, useState } from "react";
import { COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";

type Column = {
  id: string;
  declarationNo: string | null;
  customerName: string;
  declarationDate: string | null;
  isCurrent: boolean;
};

type Row = { category: string; valuesByShipmentId: Record<string, number> };

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

export default function SimilarCostsModal({ shipmentId, onClose }: { shipmentId: string; onClose: () => void }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [keyword, setKeyword] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/costs/similar?shipmentId=${shipmentId}`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải dữ liệu so sánh.");
        setColumns(json.data.columns);
        setRows(json.data.rows);
        setKeyword(json.data.keyword);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, [shipmentId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-[95vw] flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-medium text-gray-900">
            So sánh chi phí với lô hàng tương tự{keyword ? ` (nhóm hàng: ${keyword})` : ""}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Đóng">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {isLoading && <p className="text-center text-gray-400">Đang tải...</p>}
          {error && <p className="text-center text-red-600">{error}</p>}
          {!isLoading && !error && columns.length <= 1 && (
            <p className="text-center text-gray-400">
              Không tìm thấy lô hàng nào có tên hàng tương tự để so sánh.
            </p>
          )}
          {!isLoading && !error && columns.length > 1 && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="sticky left-0 bg-gray-50 px-3 py-2 text-left font-medium text-gray-500">
                      Danh mục
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className={`px-3 py-2 text-left font-medium ${
                          col.isCurrent ? "bg-blue-50 text-blue-700" : "text-gray-500"
                        }`}
                      >
                        <div>{col.declarationNo || "—"}</div>
                        <div className="text-xs font-normal text-gray-400">{col.customerName}</div>
                        <div className="text-xs font-normal text-gray-400">
                          {col.declarationDate ? new Date(col.declarationDate).toLocaleDateString("vi-VN") : "—"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((row) => (
                    <tr key={row.category}>
                      <td className="sticky left-0 bg-white px-3 py-2 font-medium text-gray-900">
                        {COST_CATEGORY_LABELS[row.category] ?? row.category}
                      </td>
                      {columns.map((col) => {
                        const value = row.valuesByShipmentId[col.id] ?? 0;
                        return (
                          <td
                            key={col.id}
                            className={`px-3 py-2 ${col.isCurrent ? "bg-blue-50/50 font-medium text-gray-900" : "text-gray-600"}`}
                          >
                            {value > 0 ? formatVnd(value) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300">
                    <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-gray-900">Tổng</td>
                    {columns.map((col) => {
                      const total = COST_CATEGORY_OPTIONS.reduce(
                        (sum, category) =>
                          sum + (rows.find((r) => r.category === category)?.valuesByShipmentId[col.id] ?? 0),
                        0
                      );
                      return (
                        <td key={col.id} className={`px-3 py-2 font-semibold ${col.isCurrent ? "bg-blue-50/50" : ""}`}>
                          {formatVnd(total)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
