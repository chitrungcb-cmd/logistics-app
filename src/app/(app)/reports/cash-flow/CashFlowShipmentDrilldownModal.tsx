"use client";

import { useEffect, useMemo, useState } from "react";
import AttachmentPreviewButton from "@/components/shipments/AttachmentPreviewButton";

export type CashFlowKind = "RECEIPT" | "EXPENSE";

type FlowTransaction = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountName: string | null;
  counterparty: string | null;
  invoiceNumber: string | null;
  note: string | null;
  attachmentUrl: string | null;
};

type ShipmentFlowGroup = {
  key: string;
  shipment: {
    id: string;
    declarationNo: string | null;
    declarationDate: string | null;
    goodsName: string | null;
    customerName: string;
    invoiceNo: string | null;
  } | null;
  fallbackLabel: string | null;
  totalAmount: number;
  transactionCount: number;
  latestTransactionDate: string;
  transactions: FlowTransaction[];
};

type FlowData = {
  kind: CashFlowKind;
  totalAmount: number;
  shipmentCount: number;
  transactionCount: number;
  rows: ShipmentFlowGroup[];
  period: { from: string; to: string } | null;
};

function formatVnd(value: number) {
  return `${Math.round(value).toLocaleString("vi-VN")} đ`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("vi-VN");
}

function groupSearchText(group: ShipmentFlowGroup) {
  return [
    group.shipment?.declarationNo,
    group.shipment?.goodsName,
    group.shipment?.customerName,
    group.shipment?.invoiceNo,
    group.fallbackLabel,
    ...group.transactions.flatMap((transaction) => [
      transaction.label,
      transaction.accountName,
      transaction.counterparty,
      transaction.invoiceNumber,
      transaction.note,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("vi");
}

export default function CashFlowShipmentDrilldownModal({
  kind,
  dateFrom,
  dateTo,
  onClose,
}: {
  kind: CashFlowKind;
  dateFrom?: string;
  dateTo?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind });
    if (dateFrom && dateTo) {
      params.set("dateFrom", dateFrom);
      params.set("dateTo", dateTo);
    }

    fetch(`/api/reports/cash-flow/shipments?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Không thể tải danh sách lô.");
        }
        setData(json.data);
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Không thể tải danh sách lô.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [dateFrom, dateTo, kind]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (selectedKey) setSelectedKey(null);
      else onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, selectedKey]);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    if (!normalizedSearch) return data.rows;
    return data.rows.filter((group) => groupSearchText(group).includes(normalizedSearch));
  }, [data, search]);

  const selectedGroup = data?.rows.find((group) => group.key === selectedKey) ?? null;
  const isReceipt = kind === "RECEIPT";
  const title = isReceipt ? "Các lô đã thu" : "Các lô đã chi";
  const detailTitle = isReceipt ? "Chi tiết đã thu" : "Chi tiết đã chi";
  const amountTone = isReceipt ? "text-emerald-700" : "text-red-700";
  const surfaceTone = isReceipt
    ? "border-emerald-200 bg-emerald-50"
    : "border-red-200 bg-red-50";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-start gap-3">
            {selectedGroup && (
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                className="mt-0.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                ← Danh sách lô
              </button>
            )}
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wide ${amountTone}`}>
                {selectedGroup ? detailTitle : title}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-gray-900">
                {selectedGroup
                  ? selectedGroup.shipment
                    ? `TK ${selectedGroup.shipment.declarationNo || "chưa có số"} · ${
                        selectedGroup.shipment.goodsName || "Chưa có tên hàng"
                      }`
                    : selectedGroup.fallbackLabel || "Công nợ chưa gắn lô"
                  : title}
              </h2>
              {selectedGroup?.shipment && (
                <p className="mt-1 text-sm text-gray-500">
                  {formatDate(selectedGroup.shipment.declarationDate)} ·{" "}
                  {selectedGroup.shipment.customerName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 hover:text-gray-700"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>

        {selectedGroup ? (
          <div className="space-y-5 p-6">
            <div className={`grid gap-4 rounded-xl border p-4 sm:grid-cols-3 ${surfaceTone}`}>
              <div>
                <p className="text-xs text-gray-500">{isReceipt ? "Tổng đã thu" : "Tổng đã chi"}</p>
                <p className={`mt-1 text-2xl font-bold ${amountTone}`}>
                  {formatVnd(selectedGroup.totalAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Số giao dịch</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {selectedGroup.transactionCount} khoản
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Invoice trên tờ khai</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {selectedGroup.shipment?.invoiceNo || "—"}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Ngày</th>
                    <th className="px-3 py-2">Nội dung</th>
                    <th className="px-3 py-2">Đối tượng</th>
                    <th className="px-3 py-2">{isReceipt ? "TK nhận" : "TK chi"}</th>
                    <th className="px-3 py-2">Số hóa đơn</th>
                    <th className="px-3 py-2">Ghi chú</th>
                    <th className="px-3 py-2">Chứng từ</th>
                    <th className="px-3 py-2 text-right">Số tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedGroup.transactions.map((transaction) => (
                    <tr key={transaction.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                        {formatDate(transaction.date)}
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900">{transaction.label}</td>
                      <td className="max-w-56 px-3 py-3 text-gray-600">
                        {transaction.counterparty || "—"}
                      </td>
                      <td className="max-w-56 px-3 py-3 text-gray-600">
                        {transaction.accountName || "Chưa xác định"}
                      </td>
                      <td className="px-3 py-3 text-gray-600">
                        {transaction.invoiceNumber || "—"}
                      </td>
                      <td className="max-w-64 px-3 py-3 text-gray-500">
                        {transaction.note || "—"}
                      </td>
                      <td className="px-3 py-3">
                        {transaction.attachmentUrl ? (
                          <AttachmentPreviewButton
                            url={transaction.attachmentUrl}
                            name="Chứng từ giao dịch"
                            className="font-medium text-blue-600 hover:underline"
                          >
                            Xem tệp
                          </AttachmentPreviewButton>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${amountTone}`}>
                        {formatVnd(transaction.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            {loading ? (
              <p className="py-16 text-center text-gray-400">Đang tải danh sách lô...</p>
            ) : error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : data ? (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className={`rounded-xl border p-4 ${surfaceTone}`}>
                    <p className="text-xs text-gray-500">{isReceipt ? "Tổng đã thu" : "Tổng đã chi"}</p>
                    <p className={`mt-1 text-2xl font-bold ${amountTone}`}>{formatVnd(data.totalAmount)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs text-gray-500">Số lô hàng</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900">{data.shipmentCount} lô</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs text-gray-500">Số giao dịch</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900">{data.transactionCount} khoản</p>
                  </div>
                </div>

                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="input w-full"
                  placeholder="Tìm theo công ty, tên hàng, số tờ khai hoặc invoice..."
                  autoFocus
                />

                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full min-w-[1020px] text-sm">
                    <thead className="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-center">STT</th>
                        <th className="px-3 py-2">Số TK / ngày TK</th>
                        <th className="px-3 py-2">Tên hàng / khách hàng</th>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2 text-center">Số khoản</th>
                        <th className="px-3 py-2 text-right">
                          {isReceipt ? "Đã thu" : "Đã chi"}
                        </th>
                        <th className="px-3 py-2 text-right">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredRows.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-12 text-center text-gray-400">
                            Không tìm thấy lô phù hợp.
                          </td>
                        </tr>
                      )}
                      {filteredRows.map((group, index) => (
                        <tr
                          key={group.key}
                          onClick={() => setSelectedKey(group.key)}
                          className="cursor-pointer hover:bg-blue-50/60"
                        >
                          <td className="px-3 py-3 text-center text-gray-400">{index + 1}</td>
                          <td className="px-3 py-3">
                            {group.shipment ? (
                              <>
                                <p className="font-medium text-blue-700">
                                  TK {group.shipment.declarationNo || "chưa có số"}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {formatDate(group.shipment.declarationDate)}
                                </p>
                              </>
                            ) : (
                              <p className="font-medium text-amber-700">Chưa gắn lô</p>
                            )}
                          </td>
                          <td className="max-w-md px-3 py-3">
                            <p className="font-medium text-gray-900">
                              {group.shipment?.goodsName || group.fallbackLabel || "Chưa có tên hàng"}
                            </p>
                            {group.shipment && (
                              <p className="truncate text-xs text-gray-500">
                                {group.shipment.customerName}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-gray-600">
                            {group.shipment?.invoiceNo ||
                              group.transactions.find((transaction) => transaction.invoiceNumber)
                                ?.invoiceNumber ||
                              "—"}
                          </td>
                          <td className="px-3 py-3 text-center text-gray-600">
                            {group.transactionCount}
                          </td>
                          <td className={`px-3 py-3 text-right font-semibold ${amountTone}`}>
                            {formatVnd(group.totalAmount)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedKey(group.key);
                              }}
                              className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              Xem chi tiết
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
