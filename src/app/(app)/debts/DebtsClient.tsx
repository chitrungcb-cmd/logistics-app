"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import VendorCombobox from "@/components/vendors/VendorCombobox";
import {
  DEBT_TYPE_LABELS,
  DEBT_STATUS_OPTIONS,
  DEBT_STATUS_LABELS,
  debtStatusBadge,
  isOverdue,
} from "@/lib/debt-constants";

const ALL_FILTER = "__all__";
const OVERDUE_FILTER = "__overdue__";

type ShipmentOption = {
  id: string;
  shipmentCode: string;
  customerName: string;
  goodsName: string | null;
  declarationNo: string | null;
  declarationDate: string | null;
  invoiceNo: string | null;
};

type DebtRow = {
  id: string;
  type: "RECEIVABLE" | "PAYABLE";
  customerId: string | null;
  vendorId: string | null;
  shipmentId: string | null;
  totalAmount: number;
  dueDate: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  customer: { id: string; companyName: string; taxCode: string } | null;
  vendor: { id: string; name: string } | null;
  shipment: ShipmentOption | null;
  paidAmount: number;
  remainingAmount: number;
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

function shipmentLabelFor(s: ShipmentOption) {
  return `${s.goodsName || "Chưa có tên hàng"} - TK ${s.declarationNo || "—"} - INV ${s.invoiceNo || "—"} - ${s.customerName}`;
}

const emptyForm = {
  customerName: "",
  customerId: null as string | null,
  vendorName: "",
  vendorId: null as string | null,
  shipmentId: "",
  shipmentLabel: "",
  totalAmount: "",
  dueDate: "",
  note: "",
};

const AGING_BUCKETS = [
  { label: "0-30 ngày", min: 0, max: 30 },
  { label: "31-60 ngày", min: 31, max: 60 },
  { label: "61-90 ngày", min: 61, max: 90 },
  { label: "Trên 90 ngày", min: 91, max: Infinity },
];

function daysOverdue(dueDate: string) {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
}

export default function DebtsClient() {
  const router = useRouter();

  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"RECEIVABLE" | "PAYABLE">("RECEIVABLE");
  const [filters, setFilters] = useState({
    search: "",
    status: ALL_FILTER,
    dueFrom: "",
    dueTo: "",
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [isShipmentDropdownOpen, setIsShipmentDropdownOpen] = useState(false);
  const shipmentFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/debts")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải danh sách công nợ.");
        setDebts(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/shipments")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setShipments(json.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (shipmentFieldRef.current && !shipmentFieldRef.current.contains(event.target as Node)) {
        setIsShipmentDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Suggests a starting totalAmount from the shipment's Quote (RECEIVABLE) or Σ ShipmentCost.costPrice
  // (PAYABLE, ADMIN-only) — a convenience prefill only, never overwrites a value the user already typed.
  useEffect(() => {
    if (!form.shipmentId) return;
    let cancelled = false;
    fetch(`/api/debts/suggest-amount?shipmentId=${form.shipmentId}&type=${activeTab}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setSuggestedAmount(json.data.suggestedAmount);
      })
      .catch(() => {
        if (!cancelled) setSuggestedAmount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.shipmentId, activeTab]);

  const shipmentSuggestions = useMemo(() => {
    const query = form.shipmentLabel.trim().toLowerCase();
    if (!query) return shipments.slice(0, 20);
    return shipments
      .filter(
        (s) =>
          s.customerName.toLowerCase().includes(query) ||
          (s.goodsName || "").toLowerCase().includes(query) ||
          (s.declarationNo || "").toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [shipments, form.shipmentLabel]);

  const tabDebts = useMemo(() => debts.filter((d) => d.type === activeTab), [debts, activeTab]);

  const filteredDebts = useMemo(() => {
    return tabDebts.filter((d) => {
      if (filters.search) {
        const query = filters.search.toLowerCase();
        const name = (d.customer?.companyName || d.vendor?.name || "").toLowerCase();
        if (!name.includes(query)) return false;
      }
      if (filters.status === OVERDUE_FILTER) {
        if (!isOverdue(d.status, d.dueDate)) return false;
      } else if (filters.status !== ALL_FILTER && d.status !== filters.status) {
        return false;
      }
      if (filters.dueFrom && (!d.dueDate || new Date(d.dueDate) < new Date(filters.dueFrom))) return false;
      if (filters.dueTo && (!d.dueDate || new Date(d.dueDate) > new Date(`${filters.dueTo}T23:59:59`))) return false;
      return true;
    });
  }, [tabDebts, filters]);

  const kpi = useMemo(() => {
    const tongPhaiThu = debts
      .filter((d) => d.type === "RECEIVABLE")
      .reduce((sum, d) => sum + d.remainingAmount, 0);
    const tongPhaiTra = debts
      .filter((d) => d.type === "PAYABLE")
      .reduce((sum, d) => sum + d.remainingAmount, 0);
    const tongQuaHan = debts
      .filter((d) => isOverdue(d.status, d.dueDate))
      .reduce((sum, d) => sum + d.remainingAmount, 0);
    return { tongPhaiThu, tongPhaiTra, tongQuaHan };
  }, [debts]);

  const agingReport = useMemo(() => {
    const overdue = tabDebts.filter((d) => isOverdue(d.status, d.dueDate) && d.dueDate);
    return AGING_BUCKETS.map((bucket) => {
      const inBucket = overdue.filter((d) => {
        const days = daysOverdue(d.dueDate!);
        return days >= bucket.min && days <= bucket.max;
      });
      return {
        label: bucket.label,
        count: inBucket.length,
        total: inBucket.reduce((sum, d) => sum + d.remainingAmount, 0),
      };
    });
  }, [tabDebts]);

  function resetForm() {
    setForm(emptyForm);
    setSuggestedAmount(null);
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (activeTab === "RECEIVABLE" && !form.customerId && !form.customerName.trim()) {
      setFormError("Vui lòng chọn khách hàng.");
      return;
    }
    if (activeTab === "PAYABLE" && !form.vendorId) {
      setFormError("Vui lòng chọn nhà cung cấp.");
      return;
    }
    if (!form.totalAmount || Number(form.totalAmount) <= 0) {
      setFormError("Vui lòng nhập tổng tiền hợp lệ.");
      return;
    }

    try {
      const res = await fetch("/api/debts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          customerId: activeTab === "RECEIVABLE" ? form.customerId : null,
          vendorId: activeTab === "PAYABLE" ? form.vendorId : null,
          shipmentId: form.shipmentId || null,
          totalAmount: form.totalAmount,
          dueDate: form.dueDate || null,
          note: form.note,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể tạo công nợ.");

      setDebts((prev) => [json.data, ...prev]);
      resetForm();
      setIsFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Công nợ</h1>
          <p className="mt-1 text-sm text-gray-500">Theo dõi công nợ phải thu và phải trả.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setIsFormOpen(true);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Thêm công nợ
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard icon="📥" label="Tổng phải thu" value={formatVnd(kpi.tongPhaiThu)} valueClassName="text-blue-700" />
        <KpiCard icon="📤" label="Tổng phải trả" value={formatVnd(kpi.tongPhaiTra)} valueClassName="text-orange-700" />
        <KpiCard icon="⚠️" label="Tổng quá hạn" value={formatVnd(kpi.tongQuaHan)} valueClassName="text-red-600" />
      </div>

      <div className="mb-4 flex gap-2 border-b border-gray-200">
        {(["RECEIVABLE", "PAYABLE"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {DEBT_TYPE_LABELS[tab]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          placeholder={activeTab === "RECEIVABLE" ? "Tìm khách hàng..." : "Tìm nhà cung cấp..."}
          className="input max-w-xs"
        />
        <select
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
          className="input w-auto"
        >
          <option value={ALL_FILTER}>Tất cả trạng thái</option>
          {DEBT_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {DEBT_STATUS_LABELS[option]}
            </option>
          ))}
          <option value={OVERDUE_FILTER}>Quá hạn</option>
        </select>
        <span className="text-sm text-gray-400">Hạn thanh toán:</span>
        <input
          type="date"
          value={filters.dueFrom}
          onChange={(e) => setFilters((prev) => ({ ...prev, dueFrom: e.target.value }))}
          className="input w-auto"
        />
        <span className="text-sm text-gray-400">đến</span>
        <input
          type="date"
          value={filters.dueTo}
          onChange={(e) => setFilters((prev) => ({ ...prev, dueTo: e.target.value }))}
          className="input w-auto"
        />
        {(filters.search || filters.status !== ALL_FILTER || filters.dueFrom || filters.dueTo) && (
          <button
            type="button"
            onClick={() => setFilters({ search: "", status: ALL_FILTER, dueFrom: "", dueTo: "" })}
            className="text-sm text-gray-500 hover:underline"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {activeTab === "RECEIVABLE" ? "Khách hàng" : "Nhà cung cấp"}
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Lô hàng liên quan</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tổng tiền</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Đã thanh toán</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Còn lại</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Hạn thanh toán</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  Đang tải dữ liệu...
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!isLoading && !error && filteredDebts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                  {tabDebts.length === 0 ? "Chưa có công nợ nào." : "Không có công nợ khớp bộ lọc."}
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              filteredDebts.map((debt) => {
                const badge = debtStatusBadge(debt.status, debt.dueDate);
                return (
                  <tr
                    key={debt.id}
                    onClick={() => router.push(`/debts/${debt.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {debt.customer?.companyName || debt.vendor?.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {debt.shipment ? (
                        <Link
                          href={`/shipments/${debt.shipment.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {debt.shipment.goodsName || debt.shipment.shipmentCode}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatVnd(debt.totalAmount)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatVnd(debt.paidAmount)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatVnd(debt.remainingAmount)}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {debt.dueDate ? new Date(debt.dueDate).toLocaleDateString("vi-VN") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-3 text-base font-semibold text-gray-900">Báo cáo tuổi nợ quá hạn</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {agingReport.map((bucket) => (
            <div key={bucket.label} className="rounded-md border border-gray-200 p-3">
              <p className="text-xs font-medium text-gray-500">{bucket.label}</p>
              <p className="mt-1 text-lg font-semibold text-red-600">{formatVnd(bucket.total)}</p>
              <p className="text-xs text-gray-400">{bucket.count} khoản</p>
            </div>
          ))}
        </div>
      </section>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsFormOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              Thêm công nợ {DEBT_TYPE_LABELS[activeTab].toLowerCase()}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {activeTab === "RECEIVABLE" ? (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Khách hàng</span>
                  <CustomerCombobox
                    customerName={form.customerName}
                    customerId={form.customerId}
                    onChange={({ customerName, customerId }) =>
                      setForm((prev) => ({ ...prev, customerName, customerId }))
                    }
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Nhà cung cấp</span>
                  <VendorCombobox
                    vendorName={form.vendorName}
                    vendorId={form.vendorId}
                    onChange={({ vendorName, vendorId }) => setForm((prev) => ({ ...prev, vendorName, vendorId }))}
                  />
                </label>
              )}

              <div className="relative" ref={shipmentFieldRef}>
                <span className="mb-1 block text-sm font-medium text-gray-700">Lô hàng liên quan (tùy chọn)</span>
                <input
                  value={form.shipmentLabel}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, shipmentLabel: e.target.value, shipmentId: "" }));
                    setSuggestedAmount(null);
                    setIsShipmentDropdownOpen(true);
                  }}
                  onFocus={() => setIsShipmentDropdownOpen(true)}
                  className="input"
                  placeholder="Tìm theo tên hàng, khách hàng hoặc số tờ khai..."
                  autoComplete="off"
                />
                {isShipmentDropdownOpen && shipmentSuggestions.length > 0 && (
                  <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                    {shipmentSuggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, shipmentId: s.id, shipmentLabel: shipmentLabelFor(s) }));
                            setIsShipmentDropdownOpen(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium text-gray-900">{s.goodsName || "Chưa có tên hàng"}</span>
                          <span className="ml-2 text-xs text-gray-400">
                            TK: {s.declarationNo || "—"} · {s.customerName}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Tổng tiền</span>
                <input
                  type="number"
                  value={form.totalAmount}
                  onChange={(e) => setForm((prev) => ({ ...prev, totalAmount: e.target.value }))}
                  className="input"
                  min={0}
                />
                {suggestedAmount !== null && (
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, totalAmount: String(suggestedAmount) }))}
                    className="mt-1 text-xs text-blue-600 hover:underline"
                  >
                    Gợi ý: {formatVnd(suggestedAmount)} (dùng số này)
                  </button>
                )}
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Hạn thanh toán</span>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                  className="input"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  rows={2}
                  className="input"
                />
              </label>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  + Thêm công nợ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setIsFormOpen(false);
                  }}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: string;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
        <span className="text-lg">{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-2xl font-bold text-gray-900 ${valueClassName ?? ""}`}>{value}</p>
    </div>
  );
}
