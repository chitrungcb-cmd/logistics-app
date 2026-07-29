"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import AttachmentPreviewModal from "@/components/shipments/AttachmentPreviewModal";
import Badge from "@/components/shipments/Badge";
import ShipmentEditModal from "@/components/shipments/ShipmentEditModal";
import ShipmentDetailsTable from "@/components/shipments/ShipmentDetailsTable";
import TaskStepper from "@/components/shipments/TaskStepper";
import {
  channelBadgeClass,
  hasHysAttachment,
  shipmentRequiresHys,
  statusBadgeClass,
  type Attachment,
} from "@/lib/shipment-constants";
import { COST_CATEGORY_LABELS } from "@/lib/shipment-cost-constants";
import type { ShipmentDTO } from "@/lib/types";

const DebtDetailClient = dynamic(
  () => import("@/app/(app)/debts/[id]/DebtDetailClient"),
  {
    ssr: false,
    loading: () => <p className="p-10 text-center text-sm text-gray-400">Đang tải chi tiết công nợ...</p>,
  }
);

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
  status: string;
  costs: PayableCost[];
};

type Viewer = {
  id: string;
  role: string;
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
  const [isEditing, setIsEditing] = useState(false);
  const [debts, setDebts] = useState<ShipmentDebt[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
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

  const loadDebts = useCallback(() => {
    return fetch(`/api/shipments/${shipmentId}/debts`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        // 403 (FIELD_STAFF) hoặc lỗi → không hiện mục công nợ; không chặn phần còn lại.
        if (json?.success) setDebts(json.data);
      })
      .catch(() => {
        /* mục công nợ là bổ sung, lỗi tải bỏ qua */
      });
  }, [shipmentId]);

  useEffect(() => {
    void loadDebts();
  }, [loadDebts]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (json?.success && json.data?.user) setViewer(json.data.user);
      })
      .catch(() => {
        /* API chi tiết công nợ vẫn tự kiểm tra quyền; chỉ ẩn thao tác quản trị khi chưa tải được người dùng. */
      });
  }, []);

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isEditing) {
        setIsEditing(false);
      } else if (selectedDebtId) {
        setSelectedDebtId(null);
        void loadDebts();
      } else {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isEditing, loadDebts, onClose, selectedDebtId]);

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
                              <button
                                type="button"
                                onClick={() => setSelectedDebtId(debt.id)}
                                className="text-xs font-medium text-blue-600 hover:underline"
                              >
                                Mở chi tiết →
                              </button>
                            </div>
                            <p className="mt-0.5 text-xs text-gray-500">{debt.partnerName}</p>
                            <dl className="mt-2 space-y-1 text-sm">
                              <div className="flex justify-between"><dt className="text-gray-500">Tổng tiền</dt><dd className="font-medium text-gray-900">{formatVnd(debt.totalAmount)}</dd></div>
                              <div className="flex justify-between"><dt className="text-gray-500">Đã thanh toán</dt><dd className="font-medium text-green-700">{formatVnd(debt.paidAmount)}</dd></div>
                              <div className="flex justify-between border-t border-gray-200/70 pt-1"><dt className="text-gray-600">Còn lại</dt><dd className="font-semibold text-gray-900">{formatVnd(debt.remainingAmount)}</dd></div>
                            </dl>
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
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">Chứng từ đính kèm</h3>
                    {shipmentRequiresHys(shipment.goodsName) && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          hasHysAttachment(shipment.attachments)
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {hasHysAttachment(shipment.attachments)
                          ? "HYS · Đã có chứng từ"
                          : "HYS · Còn thiếu chứng từ"}
                      </span>
                    )}
                  </div>
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
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                ✏️ Chỉnh sửa lô hàng
              </button>
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
        key={`${previewing?.url}-${previewing?.uploadedAt}`}
        attachment={previewing}
        shipmentId={shipmentId}
        onClose={() => setPreviewing(null)}
        onAttachmentReplaced={(current, replacement) => {
          setShipment((existing) =>
            existing
              ? {
                  ...existing,
                  attachments: (existing.attachments ?? []).map((attachment) =>
                    attachment.url === current.url ? replacement : attachment
                  ),
                }
              : existing
          );
          setPreviewing(replacement);
        }}
      />

      {isEditing && shipment && (
        <ShipmentEditModal
          key={`${shipment.id}-${shipment.updatedAt}`}
          shipment={shipment}
          onClose={() => setIsEditing(false)}
          onSaved={(updatedShipment) => {
            setShipment(updatedShipment);
            setIsEditing(false);
          }}
        />
      )}

      {selectedDebtId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-5"
          onClick={() => {
            setSelectedDebtId(null);
            void loadDebts();
          }}
          role="presentation"
        >
          <div
            className="flex max-h-[95vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-gray-50 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="debt-detail-modal-title"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-3 sm:px-6">
              <div>
                <h2 id="debt-detail-modal-title" className="text-lg font-semibold text-gray-950">
                  Chi tiết công nợ
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">Xem và cập nhật ngay tại cửa sổ lô hàng.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedDebtId(null);
                  void loadDebts();
                }}
                className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Đóng cửa sổ chi tiết công nợ"
              >
                ×
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              {viewer ? (
                <DebtDetailClient
                  key={selectedDebtId}
                  debtId={selectedDebtId}
                  isAdmin={viewer.role === "ADMIN"}
                  currentUserId={viewer.id}
                  displayMode="modal"
                  onClose={() => {
                    setSelectedDebtId(null);
                    void loadDebts();
                  }}
                  onSelectDebt={setSelectedDebtId}
                />
              ) : (
                <p className="p-10 text-center text-sm text-gray-400">Đang xác định quyền truy cập...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}
