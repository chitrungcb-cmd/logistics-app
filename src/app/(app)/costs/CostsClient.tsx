"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import SimilarCostsModal from "@/components/shipments/SimilarCostsModal";
import CostDetailPanel from "@/components/shipments/CostDetailPanel";
import {
  COST_CATEGORY_BADGE_CLASS,
  COST_CATEGORY_ICON,
  COST_CATEGORY_LABELS,
  COST_CATEGORY_OPTIONS,
} from "@/lib/shipment-cost-constants";

const ANOMALY_THRESHOLD = 1.3; // warn once unitPrice exceeds the historical average by 30%
const PAGE_SIZE_OPTIONS = [9, 18, 36, 90];

type ShipmentOption = {
  id: string;
  shipmentCode: string;
  customerName: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  invoiceNo: string | null;
};

type ShipmentRef = {
  id: string;
  shipmentCode: string;
  customerName: string;
  goodsName: string | null;
  declarationNo: string | null;
  declarationDate: string | null;
  invoiceNo: string | null;
};

type CostRow = {
  id: string;
  shipmentId: string;
  shipment: ShipmentRef;
  category: string;
  unitPrice: number;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  isAdditional: boolean;
  invoiceNumber: string | null;
  attachmentUrl: string | null;
  note: string | null;
  createdAt: string;
};

const emptyForm = {
  id: null as string | null,
  shipmentId: "",
  shipmentLabel: "",
  category: COST_CATEGORY_OPTIONS[COST_CATEGORY_OPTIONS.length - 1] as string,
  unitPrice: "0",
  quantity: "1",
  sellPrice: "0",
  isAdditional: false,
  invoiceNumber: "",
  note: "",
  attachmentUrl: null as string | null,
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

function shipmentLabelFor(s: {
  goodsName: string | null;
  declarationNo: string | null;
  invoiceNo: string | null;
  customerName: string;
}) {
  return `${s.goodsName || "Chưa có tên hàng"} - TK ${s.declarationNo || "—"} - INV ${s.invoiceNo || "—"} - ${s.customerName}`;
}

// Renders a sliding window of page numbers around `current`, with "…" markers instead of every page
// when the range is long — keeps the footer usable even with a few dozen pages of cost rows.
function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | "...")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("...");
    result.push(p);
    prev = p;
  }
  return result;
}

export default function CostsClient() {
  const searchParams = useSearchParams();
  const initialShipmentId = searchParams.get("shipmentId") ?? "";

  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [allCosts, setAllCosts] = useState<CostRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    shipmentId: initialShipmentId,
    customer: "",
    dateFrom: "",
    dateTo: "",
    additionalOnly: false,
  });
  const [showFilters, setShowFilters] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  const [form, setForm] = useState(emptyForm);
  const [isShipmentDropdownOpen, setIsShipmentDropdownOpen] = useState(false);
  const shipmentFieldRef = useRef<HTMLDivElement>(null);
  const [anomaly, setAnomaly] = useState<{ average: number | null; sampleCount: number } | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const costsListRef = useRef<HTMLDivElement>(null);
  const [viewingCost, setViewingCost] = useState<CostRow | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);

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

  // Fetched once, unfiltered — the primary "all shipments" table always needs the complete picture
  // (including shipments with zero costs), and the "Danh sách chi phí" ledger below filters this same
  // dataset client-side instead of re-querying the server per filter change. isLoading already starts
  // true (see useState above), so there's nothing to set synchronously here.
  useEffect(() => {
    fetch("/api/costs")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải danh sách chi phí.");
        setAllCosts(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  const filteredCosts = useMemo(() => {
    return allCosts.filter((c) => {
      if (filters.shipmentId && c.shipmentId !== filters.shipmentId) return false;
      if (filters.additionalOnly && !c.isAdditional) return false;
      if (filters.customer && !c.shipment.customerName.toLowerCase().includes(filters.customer.toLowerCase())) {
        return false;
      }
      if (filters.dateFrom && new Date(c.createdAt) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(c.createdAt) > new Date(`${filters.dateTo}T23:59:59`)) return false;
      return true;
    });
  }, [allCosts, filters]);

  const pageCount = Math.max(1, Math.ceil(filteredCosts.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const paginatedCosts = useMemo(
    () => filteredCosts.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filteredCosts, safePage, pageSize]
  );

  function updateFilters(patch: Partial<typeof filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setCurrentPage(1);
  }

  // Historical average unitPrice for the selected category, among shipments with a similar goodsName
  // (last 6 months) — powers the anomaly warning below. Applies in both create and edit mode.
  useEffect(() => {
    if (!form.shipmentId || !form.category) return;
    let cancelled = false;
    fetch(`/api/costs/category-average?shipmentId=${form.shipmentId}&category=${form.category}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) setAnomaly(json.data);
      })
      .catch(() => {
        if (!cancelled) setAnomaly(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form.shipmentId, form.category]);

  const shipmentSuggestions = useMemo(() => {
    const query = form.shipmentLabel.trim().toLowerCase();
    if (!query) return shipments.slice(0, 20);
    return shipments
      .filter(
        (s) =>
          s.shipmentCode.toLowerCase().includes(query) ||
          s.customerName.toLowerCase().includes(query) ||
          (s.declarationNo || "").toLowerCase().includes(query)
      )
      .slice(0, 20);
  }, [shipments, form.shipmentLabel]);

  // KPI cards and the "Danh sách chi phí" ledger reflect the currently-filtered view.
  const totals = useMemo(() => {
    return filteredCosts.reduce(
      (acc, c) => ({ costPrice: acc.costPrice + c.costPrice, sellPrice: acc.sellPrice + c.sellPrice }),
      { costPrice: 0, sellPrice: 0 }
    );
  }, [filteredCosts]);

  const kpi = useMemo(() => {
    const tongChiPhi = totals.costPrice;
    const tongBaoGia = totals.sellPrice;
    const chiPhiCoHoaDon = filteredCosts
      .filter((c) => c.invoiceNumber && c.invoiceNumber.trim())
      .reduce((sum, c) => sum + c.costPrice, 0);
    const caNhan = tongBaoGia - chiPhiCoHoaDon;
    const soChungTu = filteredCosts.filter((c) => c.attachmentUrl).length;
    const loiNhuan = tongBaoGia - tongChiPhi;
    const tySuat = tongBaoGia > 0 ? (loiNhuan / tongBaoGia) * 100 : null;
    return { tongChiPhi, caNhan, soChungTu, loiNhuan, tySuat };
  }, [filteredCosts, totals]);

  function handleExportExcel() {
    const rows = filteredCosts.map((c, i) => ({
      "Số TT": i + 1,
      "Tên hàng": c.shipment.goodsName || "",
      "Số tờ khai": c.shipment.declarationNo || "",
      "Ngày tờ khai": c.shipment.declarationDate
        ? new Date(c.shipment.declarationDate).toLocaleDateString("vi-VN")
        : "",
      "Số invoice lô hàng": c.shipment.invoiceNo || "",
      "Khách hàng": c.shipment.customerName,
      "Danh mục": COST_CATEGORY_LABELS[c.category] ?? c.category,
      "Đơn giá": c.unitPrice,
      "Số lượng": c.quantity,
      "Giá vốn": c.costPrice,
      "Giá bán": c.sellPrice,
      "Số hóa đơn": c.invoiceNumber || "",
      "Phát sinh ngoài báo giá": c.isAdditional ? "Có" : "Không",
      "Ghi chú": c.note || "",
      "Ngày tạo": new Date(c.createdAt).toLocaleDateString("vi-VN"),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Chi phí");
    XLSX.writeFile(workbook, `chi-phi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const thanhTien = (Number(form.unitPrice) || 0) * (Number(form.quantity) || 0);
  const showAnomalyWarning =
    anomaly?.average && anomaly.average > 0 && Number(form.unitPrice) > anomaly.average * ANOMALY_THRESHOLD;
  const anomalyPercent = showAnomalyWarning
    ? Math.round(((Number(form.unitPrice) - anomaly!.average!) / anomaly!.average!) * 100)
    : 0;

  function resetForm() {
    setForm(emptyForm);
    setAnomaly(null);
  }

  // After successfully adding a row, the modal stays open with the same shipment still selected —
  // only the category/amount fields clear — so entering several cost lines for one shipment doesn't
  // require re-searching it each time.
  function resetCategoryFields() {
    setForm((prev) => ({ ...emptyForm, shipmentId: prev.shipmentId, shipmentLabel: prev.shipmentLabel }));
    setAnomaly(null);
  }

  function startEdit(cost: CostRow) {
    setForm({
      id: cost.id,
      shipmentId: cost.shipmentId,
      shipmentLabel: shipmentLabelFor(cost.shipment),
      category: cost.category,
      unitPrice: String(cost.unitPrice),
      quantity: String(cost.quantity),
      sellPrice: String(cost.sellPrice),
      isAdditional: cost.isAdditional,
      invoiceNumber: cost.invoiceNumber || "",
      note: cost.note || "",
      attachmentUrl: cost.attachmentUrl,
    });
  }

  function openNoteEditor(cost: CostRow) {
    setNoteEditingId(cost.id);
    setNoteDraft(cost.note || "");
  }

  async function handleSaveNote(costId: string) {
    const res = await fetch(`/api/costs/${costId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: noteDraft }),
    });
    const json = await res.json();
    if (json.success) {
      setAllCosts((prev) => prev.map((c) => (c.id === costId ? json.data : c)));
      setNoteEditingId(null);
    }
  }

  async function handleAttachmentChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Tải file thất bại.");
      setForm((prev) => ({ ...prev, attachmentUrl: json.data.url }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setIsUploadingAttachment(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!form.shipmentId) {
      setFormError("Vui lòng chọn lô hàng.");
      return;
    }

    const payload = {
      shipmentId: form.shipmentId,
      category: form.category,
      unitPrice: form.unitPrice,
      quantity: form.quantity,
      sellPrice: form.sellPrice,
      isAdditional: form.isAdditional,
      invoiceNumber: form.invoiceNumber,
      note: form.note,
      attachmentUrl: form.attachmentUrl,
    };

    try {
      const res = await fetch(form.id ? `/api/costs/${form.id}` : "/api/costs", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Không thể lưu chi phí.");

      if (form.id) {
        setAllCosts((prev) => prev.map((c) => (c.id === form.id ? json.data : c)));
        resetForm();
        setIsFormOpen(false);
      } else {
        setAllCosts((prev) => [json.data, ...prev]);
        resetCategoryFields();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    }
  }

  async function handleDelete(costId: string) {
    if (!confirm("Xóa khoản chi phí này?")) return;
    const res = await fetch(`/api/costs/${costId}`, { method: "DELETE" });
    const json = await res.json();
    if (json.success) setAllCosts((prev) => prev.filter((c) => c.id !== costId));
  }

  const shipmentPickerField = (
    <div className="relative" ref={shipmentFieldRef}>
      <span className="mb-1 block text-sm font-medium text-gray-700">Lô hàng</span>
      <input
        value={form.shipmentLabel}
        onChange={(e) => {
          setForm((prev) => ({ ...prev, shipmentLabel: e.target.value, shipmentId: "" }));
          setAnomaly(null);
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
                  setForm((prev) => ({
                    ...prev,
                    shipmentId: s.id,
                    shipmentLabel: shipmentLabelFor(s),
                  }));
                  setIsShipmentDropdownOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{s.goodsName || "Chưa có tên hàng"}</span>
                <span className="ml-2 text-xs text-gray-400">
                  TK: {s.declarationNo || "—"}
                  {s.declarationDate ? ` (${new Date(s.declarationDate).toLocaleDateString("vi-VN")})` : ""} · INV:{" "}
                  {s.invoiceNo || "—"} · {s.customerName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const resultStart = filteredCosts.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const resultEnd = Math.min(safePage * pageSize, filteredCosts.length);

  return (
    <div className={`p-8 ${viewingCost ? "lg:pr-[27rem]" : ""}`}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Quản lý chi phí</h1>
          <p className="mt-1 text-sm text-gray-500">Theo dõi chi phí, phát sinh và chứng từ theo từng lô hàng.</p>
        </div>
        <div className="text-right">
          <p className="inline-flex items-center gap-1 text-xs text-gray-400">
            <span>🏠</span>
            <Link href="/" className="hover:underline">
              Trang chủ
            </Link>
            <span>/ Chi phí</span>
          </p>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsFormOpen(true);
            }}
            className="mt-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            + Thêm chi phí
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon="💰"
          iconBg="bg-blue-100"
          label="Tổng chi phí"
          value={formatVnd(kpi.tongChiPhi)}
          subtitle="Tổng chi phí phát sinh"
        />
        <KpiCard
          icon="👤"
          iconBg="bg-orange-100"
          label="Cá nhân"
          value={formatVnd(kpi.caNhan)}
          subtitle="= Báo giá − Chi phí có hóa đơn"
        />
        <KpiCard icon="📄" iconBg="bg-green-100" label="Số chứng từ" value={String(kpi.soChungTu)} subtitle="Chứng từ" />
        <KpiCard
          icon="📈"
          iconBg="bg-purple-100"
          label="Lợi nhuận tạm tính"
          value={formatVnd(kpi.loiNhuan)}
          subtitle={kpi.tySuat !== null ? `Tỷ suất: ${kpi.tySuat.toFixed(1)}%` : "Chưa có báo giá"}
          valueClassName={kpi.loiNhuan >= 0 ? "text-green-700" : "text-red-600"}
        />
      </div>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIsFormOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          {form.id ? "Sửa khoản chi phí" : "Thêm khoản chi phí"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">{shipmentPickerField}</div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Danh mục</span>
              <select
                value={form.category}
                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                className="input"
              >
                {COST_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {COST_CATEGORY_LABELS[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Đơn giá</span>
              <input
                type="number"
                value={form.unitPrice}
                onChange={(e) => setForm((prev) => ({ ...prev, unitPrice: e.target.value }))}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Số lượng</span>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Giá bán</span>
              <input
                type="number"
                value={form.sellPrice}
                onChange={(e) => setForm((prev) => ({ ...prev, sellPrice: e.target.value }))}
                className="input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">Số hóa đơn</span>
              <input
                value={form.invoiceNumber}
                onChange={(e) => setForm((prev) => ({ ...prev, invoiceNumber: e.target.value }))}
                className="input"
              />
            </label>
          </div>

          <p className="text-sm text-gray-600">
            Thành tiền: <span className="font-semibold text-gray-900">{formatVnd(thanhTien)}</span>
          </p>

          {showAnomalyWarning && (
            <p className="rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
              ⚠ Đơn giá này cao hơn {anomalyPercent}% so với trung bình các lô hàng tương tự (trung bình:{" "}
              {formatVnd(anomaly!.average!)})
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isAdditional}
                onChange={(e) => setForm((prev) => ({ ...prev, isAdditional: e.target.checked }))}
              />
              Phát sinh ngoài báo giá
            </label>
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              disabled={isUploadingAttachment}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {isUploadingAttachment
                ? "Đang tải..."
                : form.attachmentUrl
                  ? "Đã đính kèm chứng từ"
                  : "+ Đính kèm chứng từ"}
            </button>
            <input ref={attachmentInputRef} type="file" className="hidden" onChange={handleAttachmentChange} />
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Ghi chú</span>
            <input
              value={form.note}
              onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              className="input"
              placeholder="VD: phí lưu kho phát sinh do khách chậm lấy hàng"
            />
          </label>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {form.id ? "Lưu thay đổi" : "+ Thêm chi phí"}
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

      <section ref={costsListRef} className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">Danh sách chi phí</h2>
          <div className="flex flex-wrap gap-3">
            {filters.shipmentId && (
              <button
                type="button"
                onClick={() => setShowSimilarModal(true)}
                className="text-sm text-blue-600 hover:underline"
              >
                So sánh với lô hàng tương tự
              </button>
            )}
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <span className="text-green-600">📊</span> Xuất Excel
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <span>🔽</span> Bộ lọc
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={filters.shipmentId}
              onChange={(e) => updateFilters({ shipmentId: e.target.value })}
              className="input w-auto max-w-xs"
            >
              <option value="">Tất cả số TT</option>
              {shipments.map((s) => (
                <option key={s.id} value={s.id}>
                  {shipmentLabelFor(s)}
                </option>
              ))}
            </select>
            <span className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-gray-400">
                🔍
              </span>
              <input
                type="text"
                value={filters.customer}
                onChange={(e) => updateFilters({ customer: e.target.value })}
                placeholder="Tìm theo khách hàng..."
                className="input w-auto max-w-xs pl-7"
              />
            </span>
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              📅 Từ ngày
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                className="input w-auto"
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              📅 Đến ngày
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => updateFilters({ dateTo: e.target.value })}
                className="input w-auto"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.additionalOnly}
                onChange={(e) => updateFilters({ additionalOnly: e.target.checked })}
              />
              Chỉ hiện phát sinh ngoài báo giá
            </label>
            {(filters.shipmentId ||
              filters.customer ||
              filters.dateFrom ||
              filters.dateTo ||
              filters.additionalOnly) && (
              <button
                type="button"
                onClick={() =>
                  updateFilters({
                    shipmentId: "",
                    customer: "",
                    dateFrom: "",
                    dateTo: "",
                    additionalOnly: false,
                  })
                }
                className="text-sm text-gray-500 hover:underline"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Số TT</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Khách hàng</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tên hàng</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Chi phí</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Báo giá</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Số hóa đơn</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Ngày tạo</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Chứng từ</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                    Đang tải dữ liệu...
                  </td>
                </tr>
              )}
              {!isLoading && error && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-red-600">
                    {error}
                  </td>
                </tr>
              )}
              {!isLoading && !error && paginatedCosts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
                    Không có khoản chi phí nào khớp bộ lọc.
                  </td>
                </tr>
              )}
              {!isLoading &&
                !error &&
                paginatedCosts.map((cost, index) => (
                  <Fragment key={cost.id}>
                    <tr
                      className={`hover:bg-blue-50 ${viewingCost?.id === cost.id ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-3 py-2 text-gray-500">{(safePage - 1) * pageSize + index + 1}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/shipments/${cost.shipment.id}`}
                          className="font-medium text-gray-900 hover:underline"
                          title={`TK: ${cost.shipment.declarationNo || "—"} · INV: ${cost.shipment.invoiceNo || "—"}`}
                        >
                          {cost.shipment.customerName}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            COST_CATEGORY_BADGE_CLASS[cost.category] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {COST_CATEGORY_ICON[cost.category]} {COST_CATEGORY_LABELS[cost.category] ?? cost.category}
                        </span>
                        <span className="ml-2 text-sm text-gray-700">{cost.note || "—"}</span>
                        {cost.isAdditional && (
                          <span className="ml-1 inline-block rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-700">
                            Phát sinh
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{formatVnd(cost.costPrice)}</td>
                      <td className="px-3 py-2 text-gray-600">{formatVnd(cost.sellPrice)}</td>
                      <td className="px-3 py-2 text-gray-600">{cost.invoiceNumber || "—"}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {new Date(cost.createdAt).toLocaleDateString("vi-VN")}
                      </td>
                      <td className="px-3 py-2">
                        {cost.attachmentUrl ? (
                          <a
                            href={cost.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            📎 1
                          </a>
                        ) : (
                          <span className="text-gray-400">📎 0</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => setViewingCost(cost)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            👁 Xem
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              startEdit(cost);
                              setIsFormOpen(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            ✏️ Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => openNoteEditor(cost)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                          >
                            📝 Ghi chú
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(cost.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                          >
                            🗑 Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                    {noteEditingId === cost.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={9} className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              className="input flex-1"
                              placeholder="Ghi chú..."
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveNote(cost.id)}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                            >
                              Lưu
                            </button>
                            <button
                              type="button"
                              onClick={() => setNoteEditingId(null)}
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Hủy
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
            </tbody>
            {!isLoading && !error && filteredCosts.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right font-medium text-gray-700">
                    Tổng ({filteredCosts.length} khoản)
                  </td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{formatVnd(totals.costPrice)}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{formatVnd(totals.sellPrice)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {!isLoading && !error && filteredCosts.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
            <p>
              Hiển thị {resultStart} – {resultEnd} trong {filteredCosts.length} kết quả
            </p>
            <div className="flex items-center gap-3">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="input w-auto"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / trang
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="rounded-md border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  ‹
                </button>
                {getPageNumbers(safePage, pageCount).map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-gray-400">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      className={`rounded-md px-3 py-1 ${
                        p === safePage
                          ? "bg-blue-600 text-white"
                          : "border border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage === pageCount}
                  className="rounded-md border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {showSimilarModal && filters.shipmentId && (
        <SimilarCostsModal shipmentId={filters.shipmentId} onClose={() => setShowSimilarModal(false)} />
      )}

      {viewingCost && (
        <CostDetailPanel
          shipmentId={viewingCost.shipmentId}
          invoiceNumber={viewingCost.invoiceNumber}
          onClose={() => setViewingCost(null)}
        />
      )}
    </div>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  subtitle,
  valueClassName,
}: {
  icon: string;
  iconBg: string;
  label: string;
  value: string;
  subtitle: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${iconBg}`}>
          {icon}
        </span>
        <span className="text-sm font-medium text-gray-500">{label}</span>
      </div>
      <p className={`mt-3 text-2xl font-bold text-gray-900 ${valueClassName ?? ""}`}>{value}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  );
}
