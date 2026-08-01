"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/shipments/Badge";
import { statusBadgeClass } from "@/lib/shipment-constants";

type CustomerShipment = {
  id: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  status: string;
};

type Customer = {
  id: string;
  companyName: string;
  taxCode: string;
  address: string | null;
  legalRepName: string | null;
  legalRepIdNumber: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  assignedUser: { id: string; name: string; email: string } | null;
  shipments: CustomerShipment[];
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}

export default function CustomerInfoModal({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomer() {
      try {
        const response = await fetch(`/api/customers/${customerId}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const json = await response.json();
        if (!response.ok || !json.success) {
          throw new Error(json.error || "Không thể tải thông tin khách hàng.");
        }
        if (!cancelled) setCustomer(json.data as Customer);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không thể tải thông tin khách hàng.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadCustomer();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const completedShipments = customer?.shipments.filter((shipment) => shipment.status === "Thông quan").length ?? 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-gray-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-info-modal-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="customer-info-modal-title" className="text-xl font-semibold text-gray-950">
              Thông tin khách hàng
            </h2>
            {customer && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span className="font-medium text-gray-700">{customer.companyName}</span>
                <span className="text-gray-300">·</span>
                <span>MST {customer.taxCode || "Chưa có"}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Đóng cửa sổ thông tin khách hàng"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {isLoading && (
            <p className="py-16 text-center text-sm text-gray-400">Đang tải thông tin khách hàng...</p>
          )}

          {!isLoading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!isLoading && customer && (
            <div className="space-y-5">
              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Summary label="Tổng số lô" value={`${customer.shipments.length} lô`} tone="blue" />
                  <Summary label="Đã thông quan" value={`${completedShipments} lô`} tone="green" />
                  <Summary
                    label="Đang xử lý"
                    value={`${customer.shipments.length - completedShipments} lô`}
                    tone="amber"
                  />
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <h3 className="mb-4 text-base font-semibold text-gray-900">Thông tin công ty</h3>
                <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  <Info label="Tên công ty" value={customer.companyName} />
                  <Info label="Mã số thuế" value={customer.taxCode} />
                  <Info label="Người đại diện pháp luật" value={customer.legalRepName} />
                  <Info label="Số CCCD đại diện" value={customer.legalRepIdNumber} />
                  <Info
                    label="Số điện thoại"
                    value={
                      customer.phone ? (
                        <a href={`tel:${customer.phone}`} className="text-blue-600 hover:underline">
                          {customer.phone}
                        </a>
                      ) : null
                    }
                  />
                  <Info
                    label="Email"
                    value={
                      customer.email ? (
                        <a href={`mailto:${customer.email}`} className="text-blue-600 hover:underline">
                          {customer.email}
                        </a>
                      ) : null
                    }
                  />
                  <Info label="Địa chỉ" value={customer.address} />
                  <Info label="Người phụ trách" value={customer.assignedUser?.name} />
                  <div className="sm:col-span-2">
                    <Info label="Ghi chú" value={customer.notes} />
                  </div>
                </dl>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-gray-900">Lô hàng đã làm</h3>
                  <span className="text-xs text-gray-400">Mới nhất ở trên</span>
                </div>
                {customer.shipments.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="whitespace-nowrap px-3 py-2.5">Ngày tờ khai</th>
                          <th className="whitespace-nowrap px-3 py-2.5">Số tờ khai</th>
                          <th className="min-w-64 px-3 py-2.5">Tên hàng</th>
                          <th className="whitespace-nowrap px-3 py-2.5">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {customer.shipments.map((shipment) => (
                          <tr key={shipment.id} className="hover:bg-gray-50">
                            <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                              {formatDate(shipment.declarationDate)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-medium text-blue-700">
                              {shipment.declarationNo || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-gray-800">{shipment.goodsName || "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              <Badge label={shipment.status} className={statusBadgeClass(shipment.status)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">Chưa có lô hàng nào liên kết với khách hàng này.</p>
                )}
              </section>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end border-t border-gray-200 bg-white px-5 py-3 sm:px-6">
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
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber";
}) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-900">{value || "—"}</dd>
    </div>
  );
}
