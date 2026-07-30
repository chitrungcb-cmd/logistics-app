"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShipmentLink from "@/components/shipments/ShipmentLink";
import { useRouter } from "next/navigation";
import CustomerCombobox from "@/components/customers/CustomerCombobox";
import VendorCombobox from "@/components/vendors/VendorCombobox";
import ShipmentFinanceEditorModal from "@/components/shipments/ShipmentFinanceEditorModal";
import MoneyInput from "@/components/MoneyInput";
import { InvoiceManagementPanel } from "@/app/(app)/partners/PartnersClient";
import {
  DEBT_TYPE_LABELS,
  DEBT_STATUS_OPTIONS,
  DEBT_STATUS_LABELS,
  debtStatusBadge,
  isOverdue,
} from "@/lib/debt-constants";
import { buildShipmentDebtMarginMap, summarizeDebts } from "@/lib/debt-summary";

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
  sourceKey: string | null;
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
  /** null = công nợ không tách hóa đơn (hiển thị như cũ, chỉ một tổng chung). */
  splitBreakdown: {
    invoiceAmount: number;
    noInvoiceAmount: number;
    paidInvoice: number;
    paidNoInvoice: number;
    remainingInvoice: number;
    remainingNoInvoice: number;
  } | null;
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

function formatSignedVnd(amount: number) {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString("vi-VN")} đ`;
}

function shipmentLabelFor(s: ShipmentOption) {
  return `${s.goodsName || "Chưa có tên hàng"} - TK ${s.declarationNo || "—"} - INV ${s.invoiceNo || "—"} - ${s.customerName}`;
}

function debtPartyName(debt: DebtRow) {
  if (debt.customer?.companyName) return debt.customer.companyName;
  if (debt.vendor?.name) return debt.vendor.name;
  if (!debt.sourceKey) return "—";

  return debt.type === "RECEIVABLE"
    ? debt.shipment?.customerName || "Khách hàng lô hàng"
    : "Chi phí lô hàng";
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

export default function DebtsClient({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();

  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"DEBTS" | "INVOICES">("DEBTS");

  const [activeTab, setActiveTab] = useState<"RECEIVABLE" | "PAYABLE">("RECEIVABLE");
  const [filters, setFilters] = useState({
    search: "",
    status: ALL_FILTER,
    dueFrom: "",
    dueTo: "",
  });

  // Lô hàng đang mở cửa sổ "Báo giá & chi phí" (ADMIN-only, vì dữ liệu chi phí chỉ ADMIN được xem).
  const [financeShipment, setFinanceShipment] = useState<ShipmentOption | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [isShipmentDropdownOpen, setIsShipmentDropdownOpen] = useState(false);
  const shipmentFieldRef = useRef<HTMLDivElement>(null);

  const loadDebts = useCallback(() => {
    return fetch("/api/debts")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải danh sách công nợ.");
        setDebts(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadDebts();
  }, [loadDebts]);

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
        const query = filters.search.trim().toLocaleLowerCase("vi");
        const searchableText = [
          debtPartyName(d),
          d.shipment?.customerName,
          d.shipment?.goodsName,
          d.shipment?.declarationNo,
          d.shipment?.invoiceNo,
          d.shipment?.shipmentCode,
          d.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("vi");
        if (!searchableText.includes(query)) return false;
      }
      if (filters.status === OVERDUE_FILTER) {
        if (!isOverdue(d.status, d.dueDate)) return false;
      } else if (filters.status !== ALL_FILTER && d.status !== filters.status) {
        return false;
      }
      if (filters.dueFrom && (!d.dueDate || new Date(d.dueDate) < new Date(filters.dueFrom))) return false;
      if (filters.dueTo && (!d.dueDate || new Date(d.dueDate) > new Date(`${filters.dueTo}T23:59:59`))) return false;
      return true;
    }).sort((a, b) => {
      const aDate = a.shipment?.declarationDate
        ? new Date(a.shipment.declarationDate).getTime()
        : new Date(a.createdAt).getTime();
      const bDate = b.shipment?.declarationDate
        ? new Date(b.shipment.declarationDate).getTime()
        : new Date(b.createdAt).getTime();
      return bDate - aDate;
    });
  }, [tabDebts, filters]);

  const filteredSummary = useMemo(() => summarizeDebts(filteredDebts), [filteredDebts]);
  const shipmentMargins = useMemo(() => buildShipmentDebtMarginMap(debts), [debts]);
  const totalShipmentMargin = useMemo(
    () => [...shipmentMargins.values()].reduce((sum, margin) => sum + margin, 0),
    [shipmentMargins]
  );
  const hasActiveFilters = Boolean(
    filters.search || filters.status !== ALL_FILTER || filters.dueFrom || filters.dueTo
  );

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
    // Chỉ cộng các công nợ phải thu CÓ tách hóa đơn — công nợ không tách không thuộc phần nào cả.
    const split = debts.filter((d) => d.type === "RECEIVABLE" && d.splitBreakdown);
    const conLaiCoHoaDon = split.reduce((sum, d) => sum + d.splitBreakdown!.remainingInvoice, 0);
    const conLaiKhongHoaDon = split.reduce((sum, d) => sum + d.splitBreakdown!.remainingNoInvoice, 0);
    return {
      tongPhaiThu,
      tongPhaiTra,
      tongQuaHan,
      hasSplit: split.length > 0,
      conLaiCoHoaDon,
      conLaiKhongHoaDon,
    };
  }, [debts]);

  const agingReport = useMemo(() => {
    const overdue = filteredDebts.filter((d) => isOverdue(d.status, d.dueDate) && d.dueDate);
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
  }, [filteredDebts]);

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
          <p className="mt-1 text-sm text-gray-500">Theo dõi phải thu, phải trả và hóa đơn đầu vào/đầu ra.</p>
        </div>
        {section === "DEBTS" && <button
          type="button"
          onClick={() => {
            resetForm();
            setIsFormOpen(true);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Thêm công nợ
        </button>}
      </div>

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        <button type="button" onClick={() => setSection("DEBTS")} className={`border-b-2 px-4 py-3 text-sm font-medium ${section === "DEBTS" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>Phải thu & phải trả</button>
        <button type="button" onClick={() => setSection("INVOICES")} className={`border-b-2 px-4 py-3 text-sm font-medium ${section === "INVOICES" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>Hóa đơn đầu vào/đầu ra</button>
      </div>

      {section === "INVOICES" ? (
        <InvoiceManagementPanel isAdmin={isAdmin} embedded />
      ) : <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon="📥"
          label="Tổng phải thu"
          value={formatVnd(kpi.tongPhaiThu)}
          valueClassName="text-blue-700"
          sub={
            kpi.hasSplit ? (
              <>
                <span className="text-green-700">Có HĐ: {formatVnd(kpi.conLaiCoHoaDon)}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span className="text-orange-700">Không HĐ: {formatVnd(kpi.conLaiKhongHoaDon)}</span>
              </>
            ) : null
          }
        />
        <KpiCard icon="📤" label="Tổng phải trả" value={formatVnd(kpi.tongPhaiTra)} valueClassName="text-orange-700" />
        <KpiCard icon="⚠️" label="Tổng quá hạn" value={formatVnd(kpi.tongQuaHan)} valueClassName="text-red-600" />
        <KpiCard
          icon="📈"
          label="Lãi/lỗ các lô đủ dữ liệu"
          value={formatSignedVnd(totalShipmentMargin)}
          valueClassName={totalShipmentMargin > 0 ? "text-emerald-700" : totalShipmentMargin < 0 ? "text-red-600" : "text-gray-600"}
          sub={`${shipmentMargins.size} lô có đủ phải thu và phải trả`}
        />
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
          placeholder="Tìm công ty, invoice, tên hàng, số tờ khai..."
          className="input w-full max-w-md"
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
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => setFilters({ search: "", status: ALL_FILTER, dueFrom: "", dueTo: "" })}
            className="text-sm text-gray-500 hover:underline"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {hasActiveFilters ? "Tổng theo kết quả lọc" : "Tổng danh sách đang hiển thị"} · {DEBT_TYPE_LABELS[activeTab]}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Tự cập nhật theo từ khóa, trạng thái và hạn thanh toán.
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
            {filteredSummary.count} khoản
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <FilteredTotalCard
            label={activeTab === "RECEIVABLE" ? "Tổng phải thu" : "Tổng phải trả"}
            value={filteredSummary.totalAmount}
            valueClassName={activeTab === "RECEIVABLE" ? "text-blue-700" : "text-orange-700"}
            invoice={filteredSummary.splitCount > 0 ? filteredSummary.invoiceAmount : undefined}
            noInvoice={filteredSummary.splitCount > 0 ? filteredSummary.noInvoiceAmount : undefined}
          />
          <FilteredTotalCard
            label="Đã thanh toán"
            value={filteredSummary.paidAmount}
            valueClassName="text-green-700"
            invoice={filteredSummary.splitCount > 0 ? filteredSummary.paidInvoice : undefined}
            noInvoice={filteredSummary.splitCount > 0 ? filteredSummary.paidNoInvoice : undefined}
          />
          <FilteredTotalCard
            label="Còn lại"
            value={filteredSummary.remainingAmount}
            valueClassName="text-red-700"
            invoice={filteredSummary.splitCount > 0 ? filteredSummary.remainingInvoice : undefined}
            noInvoice={filteredSummary.splitCount > 0 ? filteredSummary.remainingNoInvoice : undefined}
          />
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-[1450px] divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-14 px-3 py-3 text-center font-medium text-gray-500">STT</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">
                {activeTab === "RECEIVABLE" ? "Khách hàng" : "Nhà cung cấp / nguồn chi"}
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-500">Ngày tờ khai</th>
              <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-500">Số tờ khai</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tên hàng / Invoice</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Tổng tiền</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Đã thanh toán</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Còn lại</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-500">Lãi/lỗ lô hàng</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Hạn thanh toán</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-gray-400">
                  Đang tải dữ liệu...
                </td>
              </tr>
            )}
            {!isLoading && error && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!isLoading && !error && filteredDebts.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-gray-400">
                  {tabDebts.length === 0 ? "Chưa có công nợ nào." : "Không có công nợ khớp bộ lọc."}
                </td>
              </tr>
            )}
            {!isLoading &&
              !error &&
              filteredDebts.map((debt, index) => {
                const badge = debtStatusBadge(debt.status, debt.dueDate);
                return (
                  <tr
                    key={debt.id}
                    onClick={() => router.push(`/debts/${debt.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="px-3 py-3 text-center text-gray-500">{index + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div>{debtPartyName(debt)}</div>
                      {debt.sourceKey && (
                        <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          Tự động từ lô hàng
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {debt.shipment?.declarationDate
                        ? new Date(debt.shipment.declarationDate).toLocaleDateString("vi-VN")
                        : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {debt.shipment ? (
                        <ShipmentLink shipmentId={debt.shipment.id} className="font-medium text-blue-600 hover:underline">
                          {debt.shipment.declarationNo || "Chưa có số TK"}
                        </ShipmentLink>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-sm px-4 py-3 text-gray-600">
                      {debt.shipment ? (
                        <>
                          <ShipmentLink shipmentId={debt.shipment.id} className="font-medium text-gray-800 hover:text-blue-600 hover:underline">
                            {debt.shipment.goodsName || debt.shipment.shipmentCode}
                          </ShipmentLink>
                          <span className="mt-0.5 block text-[11px] text-gray-400">
                            Invoice: {debt.shipment.invoiceNo || "—"}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFinanceShipment(debt.shipment);
                              }}
                              className="mt-1 block text-[11px] font-medium text-blue-600 hover:underline"
                            >
                              Xem báo giá &amp; chi phí
                            </button>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatVnd(debt.totalAmount)}
                      <SplitLines
                        invoice={debt.splitBreakdown?.invoiceAmount}
                        noInvoice={debt.splitBreakdown?.noInvoiceAmount}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatVnd(debt.paidAmount)}
                      <SplitLines
                        invoice={debt.splitBreakdown?.paidInvoice}
                        noInvoice={debt.splitBreakdown?.paidNoInvoice}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {formatVnd(debt.remainingAmount)}
                      <SplitLines
                        invoice={debt.splitBreakdown?.remainingInvoice}
                        noInvoice={debt.splitBreakdown?.remainingNoInvoice}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                      {debt.shipmentId && shipmentMargins.has(debt.shipmentId) ? (
                        <span className={
                          shipmentMargins.get(debt.shipmentId)! > 0
                            ? "text-emerald-700"
                            : shipmentMargins.get(debt.shipmentId)! < 0
                              ? "text-red-600"
                              : "text-gray-500"
                        }>
                          {formatSignedVnd(shipmentMargins.get(debt.shipmentId)!)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
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
                <MoneyInput
                  value={form.totalAmount}
                  onValueChange={(raw) => setForm((prev) => ({ ...prev, totalAmount: raw }))}
                  className="input"
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

      {/* Sửa báo giá ở đây sẽ đồng bộ lại công nợ phải thu (syncShipmentDebts) → tải lại danh sách. */}
      {financeShipment && (
        <ShipmentFinanceEditorModal
          shipment={financeShipment}
          onClose={() => setFinanceShipment(null)}
          onCostsChanged={loadDebts}
        />
      )}
      </>}
    </div>
  );
}

/** Hai dòng phụ "Có HĐ / Không HĐ" dưới một ô tiền; không render gì với công nợ không tách hóa đơn. */
function SplitLines({ invoice, noInvoice }: { invoice?: number; noInvoice?: number }) {
  if (invoice === undefined || noInvoice === undefined) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[11px] font-normal">
      <div className="text-green-700">Có HĐ: {formatVnd(invoice)}</div>
      <div className="text-orange-700">Không HĐ: {formatVnd(noInvoice)}</div>
    </div>
  );
}

function FilteredTotalCard({
  label,
  value,
  valueClassName,
  invoice,
  noInvoice,
}: {
  label: string;
  value: number;
  valueClassName: string;
  invoice?: number;
  noInvoice?: number;
}) {
  return (
    <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${valueClassName}`}>{formatVnd(value)}</p>
      <SplitLines invoice={invoice} noInvoice={noInvoice} />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  valueClassName,
  sub,
}: {
  icon: string;
  label: string;
  value: string;
  valueClassName?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
        <span className="text-lg">{icon}</span>
        {label}
      </div>
      <p className={`mt-2 text-2xl font-bold text-gray-900 ${valueClassName ?? ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs">{sub}</p>}
    </div>
  );
}
