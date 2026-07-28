"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import Badge from "@/components/shipments/Badge";
import ShipmentDetailsTable from "@/components/shipments/ShipmentDetailsTable";
import TaskStepper from "@/components/shipments/TaskStepper";
import {
  channelBadgeClass,
  statusBadgeClass,
  type Attachment,
} from "@/lib/shipment-constants";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";
import type { ShipmentDTO } from "@/lib/types";

type PayableCost = {
  id: string;
  category: string;
  customLabel: string | null;
  costPrice: number;
  isPaid: boolean;
  paidAt: string | null;
  vendorName: string | null;
  paymentAccountLabel: string | null;
  paidConfirmedByName: string | null;
  canTick: boolean;
};

type ShipmentDebt = {
  id: string;
  type: "RECEIVABLE" | "PAYABLE";
  partnerName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string | null;
  status: string;
  canEditDate: boolean;
  costs: PayableCost[];
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

export default function ShipmentInfoModal({
  shipmentId,
  onClose,
}: {
  shipmentId: string;
  onClose: () => void;
}) {
  const [shipment, setShipment] = useState<ShipmentDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Attachment | null>(null);
  const [debts, setDebts] = useState<ShipmentDebt[]>([]);
  const [savingDebtId, setSavingDebtId] = useState<string | null>(null);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [togglingCostId, setTogglingCostId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadShipment() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/shipments/${shipmentId}`);
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || "Không thể tải thông tin lô hàng.");
        }
        if (!cancelled) setShipment(json.data as ShipmentDTO);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải thông tin lô hàng.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadShipment();
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/shipments/${shipmentId}/debts`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        // 403 (FIELD_STAFF) hoặc lỗi → không hiện mục công nợ; không chặn phần còn lại.
        if (!cancelled && json?.success) setDebts(json.data);
      })
      .catch(() => {
        /* mục công nợ là bổ sung, lỗi tải bỏ qua */
      });
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  async function toggleCostPaid(debtId: string, cost: PayableCost, nextPaid: boolean) {
    setTogglingCostId(cost.id);
    setDebtError(null);
    try {
      const res = await fetch(`/api/debts/${debtId}/payable-costs/${cost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPaid: nextPaid }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể cập nhật.");
      setDebts((current) =>
        current.map((debt) =>
          debt.id === debtId
            ? {
                ...debt,
                costs: debt.costs.map((c) =>
                  c.id === cost.id
                    ? { ...c, isPaid: json.data.isPaid, paidAt: json.data.paidAt, paidConfirmedByName: json.data.paidConfirmedBy?.name ?? null }
                    : c
                ),
              }
            : debt
        )
      );
    } catch (toggleError) {
      setDebtError(toggleError instanceof Error ? toggleError.message : "Đã có lỗi xảy ra.");
    } finally {
      setTogglingCostId(null);
    }
  }

  async function saveDebtDate(debtId: string, dueDate: string) {
    setSavingDebtId(debtId);
    setDebtError(null);
    try {
      const res = await fetch(`/api/debts/${debtId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: dueDate || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể lưu ngày thanh toán.");
      setDebts((current) => current.map((debt) => (debt.id === debtId ? { ...debt, dueDate: dueDate || null } : debt)));
    } catch (saveError) {
      setDebtError(saveError instanceof Error ? saveError.message : "Đã có lỗi xảy ra.");
    } finally {
      setSavingDebtId(null);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3 sm:p-6"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="shipment-info-title"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 sm:px-6">
            <div>
              <h2 id="shipment-info-title" className="text-xl font-semibold text-gray-900">
                Thông tin lô hàng
              </h2>
              {shipment && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-blue-700">
                    TK {shipment.declarationNo || "Chưa có số tờ khai"}
                  </span>
                  <span className="text-sm text-gray-400">·</span>
                  <span className="text-sm text-gray-500">
                    Ngày TK {formatDate(shipment.declarationDate)}
                  </span>
                  <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
                  {shipment.channel && (
                    <Badge label={shipment.channel} className={channelBadgeClass(shipment.channel)} />
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Đóng cửa sổ thông tin lô hàng"
            >
              ×
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {isLoading && <p className="py-16 text-center text-sm text-gray-400">Đang tải thông tin lô hàng...</p>}

            {!isLoading && error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {!isLoading && shipment && (
              <div className="space-y-6">
                <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-base font-semibold text-gray-900">Tiến trình xử lý</h3>
                  <TaskStepper shipmentId={shipment.id} />
                </section>

                <section className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-4 text-base font-semibold text-gray-900">Thông tin chi tiết</h3>
                  <ShipmentDetailsTable shipment={shipment} />
                </section>

                {debts.length > 0 && (
                  <section className="rounded-lg border border-gray-200 bg-white p-5">
                    <h3 className="mb-3 text-base font-semibold text-gray-900">Công nợ</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {debts.map((debt) => {
                        const isReceivable = debt.type === "RECEIVABLE";
                        return (
                          <div
                            key={debt.id}
                            className={`rounded-lg border p-4 ${isReceivable ? "border-blue-200 bg-blue-50/50" : "border-emerald-200 bg-emerald-50/50"}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`text-sm font-semibold ${isReceivable ? "text-blue-800" : "text-emerald-800"}`}>
                                {isReceivable ? "Phải thu" : "Phải trả"}
                              </span>
                              <a href={`/debts/${debt.id}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                Mở chi tiết →
                              </a>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">{debt.partnerName}</p>
                            <dl className="mt-2 space-y-1 text-sm">
                              <div className="flex justify-between"><dt className="text-gray-500">Tổng tiền</dt><dd className="font-medium text-gray-900">{formatVnd(debt.totalAmount)}</dd></div>
                              <div className="flex justify-between"><dt className="text-gray-500">Đã thanh toán</dt><dd className="font-medium text-green-700">{formatVnd(debt.paidAmount)}</dd></div>
                              <div className="flex justify-between border-t border-gray-200/70 pt-1"><dt className="text-gray-600">Còn lại</dt><dd className="font-semibold text-gray-900">{formatVnd(debt.remainingAmount)}</dd></div>
                            </dl>
                            <label className="mt-3 block">
                              <span className="mb-1 block text-xs font-medium text-gray-600">Ngày thanh toán</span>
                              <input
                                type="date"
                                defaultValue={debt.dueDate ? debt.dueDate.slice(0, 10) : ""}
                                disabled={!debt.canEditDate || savingDebtId === debt.id}
                                onChange={(event) => saveDebtDate(debt.id, event.target.value)}
                                className="input w-full disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                                title="Chọn ngày thanh toán"
                              />
                            </label>

                            {!isReceivable && debt.costs.length > 0 && (
                              <div className="mt-3 border-t border-emerald-200/70 pt-2">
                                <p className="mb-1 text-xs font-medium text-gray-600">
                                  Chi phí ({debt.costs.filter((c) => c.isPaid).length}/{debt.costs.length} đã trả) — tích khi đã thanh toán
                                </p>
                                <ul className="space-y-1">
                                  {debt.costs.map((cost) => (
                                    <li key={cost.id} className="flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={cost.isPaid}
                                        disabled={!cost.canTick || togglingCostId === cost.id}
                                        onChange={(event) => toggleCostPaid(debt.id, cost, event.target.checked)}
                                        className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                                        title={cost.canTick ? "Tích khi đã thanh toán" : "Chỉ người phụ trách khoản này mới tích được"}
                                      />
                                      <span className="min-w-0 flex-1 truncate text-gray-700">
                                        {cost.customLabel || COST_CATEGORY_LABELS[cost.category] || cost.category}
                                        {cost.vendorName ? <span className="text-gray-400"> · {cost.vendorName}</span> : null}
                                        {cost.paymentAccountLabel ? (
                                          <span className="text-gray-400"> · {cost.paymentAccountLabel}</span>
                                        ) : null}
                                      </span>
                                      <span className="shrink-0 font-medium text-gray-900">{formatVnd(cost.costPrice)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {debtError && <p className="mt-2 text-sm text-red-600">{debtError}</p>}
                  </section>
                )}

                <section className="rounded-lg border border-gray-200 bg-white p-5">
                  <h3 className="mb-3 text-base font-semibold text-gray-900">Chứng từ đính kèm</h3>
                  {shipment.attachments && shipment.attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {shipment.attachments.map((attachment, index) => (
                        <button
                          key={`${attachment.url}-${index}`}
                          type="button"
                          onClick={() => setPreviewing(attachment)}
                          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-100"
                        >
                          📎 {attachment.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Chưa có chứng từ đính kèm.</p>
                  )}
                </section>
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3 sm:px-6">
            {shipment ? (
              <Link
                href={`/shipments/${shipment.id}`}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                ✏️ Chỉnh sửa lô hàng
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Đóng
            </button>
          </footer>
        </div>
      </div>

      <AttachmentPreviewModal
        key={previewing?.url}
        attachment={previewing}
        onClose={() => setPreviewing(null)}
      />
    </>
  );
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}
