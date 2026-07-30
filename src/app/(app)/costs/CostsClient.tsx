"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { downloadExcel } from "@/lib/export-excel";
import ShipmentFinanceEditorModal from "@/components/shipments/ShipmentFinanceEditorModal";
import ShipmentInfoModal from "@/components/shipments/ShipmentInfoModal";
import {
  COST_CATEGORY_LABELS,
  isInvoiceCostCategory,
  isVendorlessCostCategory,
} from "@/lib/shipment-cost-constants";
import { calculateCostOpportunities } from "@/lib/cost-optimization";

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const SPIKE_DIFFERENCE_PERCENT = 30;

type ShipmentOption = {
  id: string;
  shipmentCode: string;
  customerName: string;
  declarationNo: string | null;
  declarationDate: string | null;
  goodsName: string | null;
  invoiceNo: string | null;
};

type CostRow = {
  id: string;
  shipmentId: string;
  shipment: ShipmentOption;
  category: string;
  unitPrice: number;
  quantity: number;
  costPrice: number;
  sellPrice: number;
  isAdditional: boolean;
  isActual: boolean;
  invoiceNumber: string | null;
  attachmentUrl: string | null;
  note: string | null;
  createdAt: string;
  vendorId: string | null;
  vendor: { id: string; name: string; type: string | null } | null;
};

type ShipmentQuoteTotal = { shipmentId: string; quoteAmount: number };

type ShipmentSummary = ShipmentOption & {
  costs: CostRow[];
  totalCost: number;
  totalRevenue: number;
  profit: number;
  missingInfoCount: number;
  opportunityCount: number;
  spikeCount: number;
};

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}

function formatSignedVnd(amount: number) {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString("vi-VN")} đ`;
}

async function readApiJson(response: Response) {
  const text = await response.text();
  if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Phản hồi máy chủ không hợp lệ (HTTP ${response.status}).`);
  }
}

async function fetchApiCollection<T>(url: string, label: string): Promise<T[]> {
  const json = await fetch(url, { cache: "no-store" }).then(readApiJson);
  if (!json.success) throw new Error(json.error || `Không thể tải ${label}.`);
  if (!Array.isArray(json.data)) throw new Error(`Dữ liệu ${label} không đúng định dạng.`);
  return json.data as T[];
}

function getLoadError(result: PromiseSettledResult<unknown>, label: string) {
  if (result.status === "fulfilled") return null;
  const detail = result.reason instanceof Error ? result.reason.message : "Đã có lỗi xảy ra.";
  return `${label}: ${detail}`;
}

export default function CostsClient() {
  const searchParams = useSearchParams();
  const initialShipmentId = searchParams.get("shipmentId") ?? "";
  const openedInitialShipment = useRef(false);

  const [shipments, setShipments] = useState<ShipmentOption[]>([]);
  const [allCosts, setAllCosts] = useState<CostRow[]>([]);
  const [quoteTotals, setQuoteTotals] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState({
    shipmentId: initialShipmentId,
    query: "",
    dateFrom: "",
    dateTo: "",
    costStatus: "ALL" as "ALL" | "EMPTY" | "ENTERED" | "INCOMPLETE",
    additionalOnly: false,
    optimizationOnly: false,
  });
  const [editingShipment, setEditingShipment] = useState<ShipmentOption | null>(null);
  const [viewingShipmentId, setViewingShipmentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      fetchApiCollection<ShipmentOption>("/api/shipments", "lô hàng"),
      fetchApiCollection<CostRow>("/api/costs", "chi phí"),
      fetchApiCollection<ShipmentQuoteTotal>("/api/costs/shipment-quote-totals", "tổng thu"),
    ]).then(([shipmentResult, costResult, quoteResult]) => {
      if (cancelled) return;

      if (shipmentResult.status === "fulfilled") {
        const loadedShipments = shipmentResult.value;
        setShipments(loadedShipments);
        if (initialShipmentId && !openedInitialShipment.current) {
          const shipment = loadedShipments.find((item) => item.id === initialShipmentId);
          if (shipment) {
            openedInitialShipment.current = true;
            setEditingShipment(shipment);
          }
        }
      }
      if (costResult.status === "fulfilled") setAllCosts(costResult.value);
      if (quoteResult.status === "fulfilled") {
        setQuoteTotals(
          Object.fromEntries(
            quoteResult.value.map((row) => [row.shipmentId, Number(row.quoteAmount) || 0])
          )
        );
      }

      const failures = [
        getLoadError(shipmentResult, "Danh sách lô hàng"),
        getLoadError(costResult, "Chi phí"),
        getLoadError(quoteResult, "Tổng thu"),
      ].filter((message): message is string => Boolean(message));
      setError(failures.length > 0 ? failures.join(" ") : null);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [initialShipmentId, reloadKey]);

  const opportunities = useMemo(() => calculateCostOpportunities(allCosts), [allCosts]);
  const opportunityByCostId = useMemo(
    () => new Map(opportunities.map((item) => [item.costId, item])),
    [opportunities]
  );

  const shipmentRows = useMemo<ShipmentSummary[]>(() => {
    const costsByShipment = new Map<string, CostRow[]>();
    for (const cost of allCosts) {
      const rows = costsByShipment.get(cost.shipmentId) ?? [];
      rows.push(cost);
      costsByShipment.set(cost.shipmentId, rows);
    }

    const query = filters.query.trim().toLowerCase();
    return shipments
      .map((shipment) => {
        const costs = costsByShipment.get(shipment.id) ?? [];
        const totalCost = costs.reduce((sum, cost) => sum + cost.costPrice, 0);
        const additionalRevenue = costs
          .filter((cost) => cost.isAdditional)
          .reduce((sum, cost) => sum + cost.sellPrice, 0);
        const totalRevenue = (quoteTotals[shipment.id] ?? 0) + additionalRevenue;
        const shipmentOpportunities = costs
          .map((cost) => opportunityByCostId.get(cost.id))
          .filter((item) => item !== undefined);
        return {
          ...shipment,
          costs,
          totalCost,
          totalRevenue,
          profit: totalRevenue - totalCost,
          missingInfoCount: costs.filter(
            (cost) =>
              (!isVendorlessCostCategory(cost.category) && !cost.vendorId) ||
              (isInvoiceCostCategory(cost.category) && !!cost.invoiceNumber && !cost.attachmentUrl)
          ).length,
          opportunityCount: shipmentOpportunities.length,
          spikeCount: shipmentOpportunities.filter(
            (item) => item.differencePercent >= SPIKE_DIFFERENCE_PERCENT
          ).length,
        };
      })
      .filter((shipment) => {
        if (filters.shipmentId && shipment.id !== filters.shipmentId) return false;
        if (
          query &&
          ![shipment.customerName, shipment.goodsName, shipment.declarationNo, shipment.invoiceNo]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(query))
        ) return false;
        if (filters.additionalOnly && !shipment.costs.some((cost) => cost.isAdditional)) return false;
        if (filters.optimizationOnly && shipment.opportunityCount === 0) return false;
        if (filters.costStatus === "EMPTY" && shipment.costs.length > 0) return false;
        if (filters.costStatus === "ENTERED" && shipment.costs.length === 0) return false;
        if (filters.costStatus === "INCOMPLETE" && shipment.missingInfoCount === 0) return false;
        if (filters.dateFrom || filters.dateTo) {
          if (!shipment.declarationDate) return false;
          const declarationDate = new Date(shipment.declarationDate);
          if (filters.dateFrom && declarationDate < new Date(filters.dateFrom)) return false;
          if (filters.dateTo && declarationDate > new Date(`${filters.dateTo}T23:59:59`)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aDate = a.declarationDate ? new Date(a.declarationDate).getTime() : 0;
        const bDate = b.declarationDate ? new Date(b.declarationDate).getTime() : 0;
        return bDate - aDate;
      });
  }, [allCosts, filters, opportunityByCostId, quoteTotals, shipments]);

  const totals = useMemo(
    () => shipmentRows.reduce(
      (result, shipment) => ({
        cost: result.cost + shipment.totalCost,
        revenue: result.revenue + shipment.totalRevenue,
        profit: result.profit + shipment.profit,
        entered: result.entered + (shipment.costs.length > 0 ? 1 : 0),
        empty: result.empty + (shipment.costs.length === 0 ? 1 : 0),
        incomplete: result.incomplete + (shipment.missingInfoCount > 0 ? 1 : 0),
      }),
      { cost: 0, revenue: 0, profit: 0, entered: 0, empty: 0, incomplete: 0 }
    ),
    [shipmentRows]
  );

  const pageCount = Math.max(1, Math.ceil(shipmentRows.length / pageSize));
  const safePage = Math.min(currentPage, pageCount);
  const paginatedShipments = shipmentRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function updateFilters(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setCurrentPage(1);
  }

  async function refreshFinancialData() {
    const [costResult, quoteResult] = await Promise.allSettled([
      fetchApiCollection<CostRow>("/api/costs", "chi phí"),
      fetchApiCollection<ShipmentQuoteTotal>("/api/costs/shipment-quote-totals", "tổng thu"),
    ]);
    if (costResult.status === "fulfilled") setAllCosts(costResult.value);
    if (quoteResult.status === "fulfilled") {
        setQuoteTotals(
          Object.fromEntries(
            quoteResult.value.map((row) => [row.shipmentId, Number(row.quoteAmount) || 0])
          )
        );
    }
    const failures = [
      getLoadError(costResult, "Chi phí"),
      getLoadError(quoteResult, "Tổng thu"),
    ].filter((message): message is string => Boolean(message));
    setError(failures.length > 0 ? failures.join(" ") : null);
  }

  async function exportExcel() {
    const summary = shipmentRows.map((shipment, index) => ({
      STT: index + 1,
      "Tên công ty": shipment.customerName,
      "Số tờ khai": shipment.declarationNo || "",
      "Ngày tờ khai": shipment.declarationDate
        ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN")
        : "",
      "Tên hàng": shipment.goodsName || "",
      "Số khoản": shipment.costs.length,
      "Tổng chi": shipment.totalCost,
      "Tổng thu": shipment.totalRevenue,
      "Lãi/lỗ": shipment.profit,
    }));
    const details = shipmentRows.flatMap((shipment) => shipment.costs.map((cost) => ({
      "Tên công ty": shipment.customerName,
      "Số tờ khai": shipment.declarationNo || "",
      "Tên hàng": shipment.goodsName || "",
      "Hạng mục": COST_CATEGORY_LABELS[cost.category] ?? cost.category,
      "Nhà cung cấp": isVendorlessCostCategory(cost.category) ? "Không áp dụng" : cost.vendor?.name || "",
      "Đơn giá": cost.unitPrice,
      "Số lượng": cost.quantity,
      "Tổng chi": cost.costPrice,
      "Số hóa đơn": cost.invoiceNumber || "",
      "Ghi chú": cost.note || "",
    })));
    await downloadExcel(`chi-phi-theo-lo-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Theo lô hàng", rows: summary },
      { name: "Chi tiết chi phí", rows: details },
    ]);
  }

  const resultStart = shipmentRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const resultEnd = Math.min(safePage * pageSize, shipmentRows.length);

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Chi phí lô hàng</h1>
          <p className="mt-1 text-sm text-gray-500">Theo dõi từng lô, nhập nhanh và sao chép các khoản đã làm mà không ghi đè dữ liệu cũ.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/reports/cost-variance" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100">
            ⚠ So sánh chênh lệch
          </Link>
          <Link href="/reports/vendor-payables" className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            📊 Báo cáo phải trả
          </Link>
        </div>
      </div>

      {error && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => { setIsLoading(true); setError(null); setReloadKey((key) => key + 1); }} className="rounded border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100">Thử lại</button></div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Tổng chi" value={formatVnd(totals.cost)} color="red" />
        <Kpi label="Lô đã nhập chi phí" value={`${totals.entered} lô`} color="green" />
        <Kpi label="Lô chưa nhập" value={`${totals.empty} lô`} color={totals.empty > 0 ? "red" : "gray"} />
        <Kpi label="Lô cần bổ sung thông tin" value={`${totals.incomplete} lô`} color={totals.incomplete > 0 ? "blue" : "gray"} />
      </div>

      <div className="mb-6 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-5 py-4 text-sm sm:grid-cols-4">
        <ProcessStep number="1" title="Chọn lô" detail="Tìm theo công ty, số tờ khai hoặc tên hàng." />
        <ProcessStep number="2" title="Nhập hoặc sao chép" detail="Chọn khoản từ lô đã làm để tiết kiệm thời gian." />
        <ProcessStep number="3" title="Kiểm tra thông tin" detail="Bổ sung nhà cung cấp, TK chi và chứng từ riêng." />
        <ProcessStep number="4" title="Đối chiếu công nợ" detail="Chi phí được đồng bộ theo đúng số tờ khai." />
      </div>

      {opportunities.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div>
            <p className="font-semibold text-emerald-900">✨ Cơ hội tối ưu chi phí</p>
            <p className="mt-0.5 text-xs text-emerald-700">
              {opportunities.length} khoản cần rà soát · Có thể tiết kiệm {formatVnd(opportunities.reduce((sum, item) => sum + item.potentialSaving, 0))}
            </p>
          </div>
          <button type="button" onClick={() => updateFilters({ optimizationOnly: !filters.optimizationOnly })} className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100">
            {filters.optimizationOnly ? "Hiện tất cả lô" : "Chỉ hiện lô cần rà soát"}
          </button>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Chi phí theo lô hàng</h2>
            <p className="text-xs text-gray-500">Lô mới nhất ở trên; bấm vào một dòng để mở cửa sổ nhập, sửa hoặc sao chép chi phí.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportExcel} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">📊 Xuất Excel</button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <select value={filters.shipmentId} onChange={(event) => updateFilters({ shipmentId: event.target.value })} className="input xl:col-span-2">
            <option value="">Tất cả số tờ khai</option>
            {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.declarationNo || "Chưa có TK"} · {shipment.goodsName || shipment.customerName}</option>)}
          </select>
          <input value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} className="input xl:col-span-2" placeholder="Tìm công ty, số TK, tên hàng..." />
          <select value={filters.costStatus} onChange={(event) => updateFilters({ costStatus: event.target.value as typeof filters.costStatus })} className="input">
            <option value="ALL">Tất cả trạng thái</option>
            <option value="EMPTY">Chưa nhập chi phí</option>
            <option value="ENTERED">Đã nhập chi phí</option>
            <option value="INCOMPLETE">Cần bổ sung thông tin</option>
          </select>
          <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} className="input" title="Từ ngày tờ khai" />
          <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} className="input" title="Đến ngày tờ khai" />
        </div>
        <label className="mb-4 inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={filters.additionalOnly} onChange={(event) => updateFilters({ additionalOnly: event.target.checked })} />
          Chỉ hiện lô có phát sinh ngoài báo giá
        </label>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[1000px] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="w-14 px-3 py-3 text-center font-medium text-gray-500">STT</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tên công ty</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Số TK / ngày TK</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tên hàng</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Tổng chi</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Tổng thu</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Lãi/lỗ</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Đang tải dữ liệu...</td></tr>}
              {!isLoading && shipmentRows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Không có lô hàng phù hợp.</td></tr>}
              {!isLoading && paginatedShipments.map((shipment, index) => {
                return <tr key={shipment.id} onClick={() => setEditingShipment(shipment)} className={`cursor-pointer ${shipment.spikeCount > 0 ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-emerald-50/60"}`} title="Bấm để mở cửa sổ nhập, sửa hoặc sao chép chi phí">
                    <td className="px-3 py-3 text-center text-gray-500">{(safePage - 1) * pageSize + index + 1}</td>
                    <td className="max-w-xs px-3 py-3 font-medium text-gray-900">{shipment.customerName}</td>
                    <td className="whitespace-nowrap px-3 py-3"><button type="button" onClick={(event) => { event.stopPropagation(); setViewingShipmentId(shipment.id); }} className="font-medium text-blue-600 hover:underline" title="Xem nhanh thông tin lô hàng">{shipment.declarationNo || "Chưa có TK"}</button><span className="block text-xs text-gray-400">{shipment.declarationDate ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN") : "—"}</span></td>
                    <td className="max-w-sm px-3 py-3 text-gray-700">{shipment.goodsName || "Chưa có tên hàng"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{formatVnd(shipment.totalCost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-blue-700">{formatVnd(shipment.totalRevenue)}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${shipment.profit > 0 ? "text-emerald-700" : shipment.profit < 0 ? "text-red-600" : "text-gray-500"}`}>{formatSignedVnd(shipment.profit)}</td>
                  </tr>;
              })}
            </tbody>
            {!isLoading && shipmentRows.length > 0 && <tfoot className="bg-gray-50"><tr><td colSpan={4} className="px-3 py-3 text-right font-medium text-gray-700">Tổng ({shipmentRows.length} lô)</td><td className="px-3 py-3 text-right font-bold text-gray-900">{formatVnd(totals.cost)}</td><td className="px-3 py-3 text-right font-bold text-blue-700">{formatVnd(totals.revenue)}</td><td className={`px-3 py-3 text-right font-bold ${totals.profit > 0 ? "text-emerald-700" : totals.profit < 0 ? "text-red-600" : "text-gray-500"}`}>{formatSignedVnd(totals.profit)}</td></tr></tfoot>}
          </table>
        </div>

        {!isLoading && shipmentRows.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
          <span>Hiển thị {resultStart}–{resultEnd} trong {shipmentRows.length} lô hàng</span>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCurrentPage(1); }} className="input w-auto">{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} / trang</option>)}</select>
            <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage === 1} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">‹</button>
            <span className="rounded bg-blue-600 px-3 py-1.5 text-white">{safePage}/{pageCount}</span>
            <button type="button" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={safePage === pageCount} className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40">›</button>
          </div>
        </div>}
      </section>

      {editingShipment && <ShipmentFinanceEditorModal shipment={editingShipment} onClose={() => setEditingShipment(null)} onCostsChanged={refreshFinancialData} />}
      {viewingShipmentId && <ShipmentInfoModal shipmentId={viewingShipmentId} onClose={() => setViewingShipmentId(null)} />}
    </div>
  );
}

function ProcessStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{number}</span>
      <div><p className="font-semibold text-gray-900">{title}</p><p className="mt-0.5 text-xs leading-5 text-gray-500">{detail}</p></div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color: "red" | "blue" | "green" | "gray" }) {
  const styles = { red: "border-red-100 bg-red-50 text-red-800", blue: "border-blue-100 bg-blue-50 text-blue-800", green: "border-emerald-100 bg-emerald-50 text-emerald-800", gray: "border-gray-200 bg-white text-gray-900" };
  return <div className={`rounded-xl border p-4 ${styles[color]}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}
