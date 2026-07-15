"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { downloadExcel } from "@/lib/export-excel";
import CostDetailPanel from "@/components/shipments/CostDetailPanel";
import ShipmentFinanceEditorModal from "@/components/shipments/ShipmentFinanceEditorModal";
import ShipmentInfoModal from "@/components/shipments/ShipmentInfoModal";
import SimilarCostsModal from "@/components/shipments/SimilarCostsModal";
import {
  COST_CATEGORY_BADGE_CLASS,
  COST_CATEGORY_ICON,
  COST_CATEGORY_LABELS,
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
  documentCount: number;
  opportunityCount: number;
  spikeCount: number;
};

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
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
    additionalOnly: false,
    optimizationOnly: false,
  });
  const [expandedShipmentId, setExpandedShipmentId] = useState<string | null>(initialShipmentId || null);
  const [editingShipment, setEditingShipment] = useState<ShipmentOption | null>(null);
  const [viewingShipmentId, setViewingShipmentId] = useState<string | null>(null);
  const [viewingCost, setViewingCost] = useState<CostRow | null>(null);
  const [similarShipmentId, setSimilarShipmentId] = useState<string | null>(null);
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
          documentCount: costs.filter((cost) => cost.attachmentUrl).length,
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
        if (filters.dateFrom || filters.dateTo) {
          if (!shipment.declarationDate) return false;
          const declarationDate = new Date(shipment.declarationDate);
          if (filters.dateFrom && declarationDate < new Date(filters.dateFrom)) return false;
          if (filters.dateTo && declarationDate > new Date(`${filters.dateTo}T23:59:59`)) return false;
        }
        return true;
      });
  }, [allCosts, filters, opportunityByCostId, quoteTotals, shipments]);

  const totals = useMemo(
    () => shipmentRows.reduce(
      (result, shipment) => ({
        cost: result.cost + shipment.totalCost,
        revenue: result.revenue + shipment.totalRevenue,
        profit: result.profit + shipment.profit,
        documents: result.documents + shipment.documentCount,
      }),
      { cost: 0, revenue: 0, profit: 0, documents: 0 }
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
      "Nhà cung cấp": cost.vendor?.name || "",
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
          <h1 className="text-2xl font-semibold text-gray-900">Chi phí</h1>
          <p className="mt-1 text-sm text-gray-500">Mỗi lô hàng chỉ hiển thị một dòng tổng hợp; mở rộng khi cần xem từng khoản.</p>
        </div>
        <Link href="/reports/vendor-payables" className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          📊 Báo cáo phải trả
        </Link>
      </div>

      {error && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => { setIsLoading(true); setError(null); setReloadKey((key) => key + 1); }} className="rounded border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100">Thử lại</button></div>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Tổng chi" value={formatVnd(totals.cost)} color="red" />
        <Kpi label="Tổng thu" value={formatVnd(totals.revenue)} color="blue" />
        <Kpi label="Lãi/lỗ" value={formatVnd(totals.profit)} color={totals.profit >= 0 ? "green" : "red"} />
        <Kpi label="Chứng từ" value={String(totals.documents)} color="gray" />
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
            <p className="text-xs text-gray-500">Một bảng duy nhất, bao gồm cả lô chưa phát sinh chi phí.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportExcel} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">📊 Xuất Excel</button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <select value={filters.shipmentId} onChange={(event) => updateFilters({ shipmentId: event.target.value })} className="input xl:col-span-2">
            <option value="">Tất cả số tờ khai</option>
            {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.declarationNo || "Chưa có TK"} · {shipment.goodsName || shipment.customerName}</option>)}
          </select>
          <input value={filters.query} onChange={(event) => updateFilters({ query: event.target.value })} className="input xl:col-span-2" placeholder="Tìm công ty, số TK, tên hàng..." />
          <input type="date" value={filters.dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} className="input" title="Từ ngày tờ khai" />
          <input type="date" value={filters.dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} className="input" title="Đến ngày tờ khai" />
        </div>
        <label className="mb-4 inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={filters.additionalOnly} onChange={(event) => updateFilters({ additionalOnly: event.target.checked })} />
          Chỉ hiện lô có phát sinh ngoài báo giá
        </label>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[1200px] divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50"><tr>
              <th className="w-14 px-3 py-3 text-center font-medium text-gray-500">STT</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tên công ty</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Số TK / ngày TK</th>
              <th className="px-3 py-3 text-left font-medium text-gray-500">Tên hàng</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Tổng chi</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Tổng thu</th>
              <th className="px-3 py-3 text-right font-medium text-gray-500">Lãi/lỗ</th>
              <th className="px-3 py-3 text-center font-medium text-gray-500">Chứng từ</th>
              <th className="px-3 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Đang tải dữ liệu...</td></tr>}
              {!isLoading && shipmentRows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Không có lô hàng phù hợp.</td></tr>}
              {!isLoading && paginatedShipments.map((shipment, index) => {
                const expanded = expandedShipmentId === shipment.id;
                return <Fragment key={shipment.id}>
                  <tr className={shipment.spikeCount > 0 ? "bg-red-50/50" : "hover:bg-gray-50"}>
                    <td className="px-3 py-3 text-center text-gray-500">{(safePage - 1) * pageSize + index + 1}</td>
                    <td className="max-w-xs px-3 py-3 font-medium text-gray-900">{shipment.customerName}</td>
                    <td className="whitespace-nowrap px-3 py-3"><button type="button" onClick={() => setViewingShipmentId(shipment.id)} className="font-medium text-blue-600 hover:underline" title="Xem nhanh thông tin lô hàng">{shipment.declarationNo || "Chưa có TK"}</button><span className="block text-xs text-gray-400">{shipment.declarationDate ? new Date(shipment.declarationDate).toLocaleDateString("vi-VN") : "—"}</span></td>
                    <td className="max-w-sm px-3 py-3 text-gray-700">{shipment.goodsName || "Chưa có tên hàng"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-900">{formatVnd(shipment.totalCost)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-blue-700">{formatVnd(shipment.totalRevenue)}</td>
                    <td className={`whitespace-nowrap px-3 py-3 text-right font-semibold ${shipment.profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatVnd(shipment.profit)}</td>
                    <td className="px-3 py-3 text-center text-gray-500">📎 {shipment.documentCount}</td>
                    <td className="px-3 py-3"><div className="flex min-w-44 justify-end gap-3"><button type="button" onClick={() => setExpandedShipmentId(expanded ? null : shipment.id)} className="text-blue-600 hover:underline">{expanded ? "Thu gọn" : `Chi tiết (${shipment.costs.length})`}</button><button type="button" onClick={() => setEditingShipment(shipment)} className="font-medium text-blue-600 hover:underline">Mở chi phí</button></div></td>
                  </tr>
                  {expanded && <tr><td colSpan={9} className="bg-slate-50 px-6 py-4"><ShipmentCostDetails shipment={shipment} opportunityByCostId={opportunityByCostId} onHistory={setViewingCost} onCompare={() => setSimilarShipmentId(shipment.id)} /></td></tr>}
                </Fragment>;
              })}
            </tbody>
            {!isLoading && shipmentRows.length > 0 && <tfoot className="bg-gray-50"><tr><td colSpan={4} className="px-3 py-3 text-right font-medium text-gray-700">Tổng ({shipmentRows.length} lô)</td><td className="px-3 py-3 text-right font-bold text-gray-900">{formatVnd(totals.cost)}</td><td className="px-3 py-3 text-right font-bold text-blue-700">{formatVnd(totals.revenue)}</td><td className={`px-3 py-3 text-right font-bold ${totals.profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>{formatVnd(totals.profit)}</td><td colSpan={2}></td></tr></tfoot>}
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

      {viewingCost && <CostDetailPanel shipmentId={viewingCost.shipmentId} invoiceNumber={viewingCost.invoiceNumber} onClose={() => setViewingCost(null)} onCostsChanged={refreshFinancialData} />}
      {similarShipmentId && <SimilarCostsModal shipmentId={similarShipmentId} onClose={() => setSimilarShipmentId(null)} />}
      {editingShipment && <ShipmentFinanceEditorModal shipment={editingShipment} onClose={() => setEditingShipment(null)} onCostsChanged={refreshFinancialData} />}
      {viewingShipmentId && <ShipmentInfoModal shipmentId={viewingShipmentId} onClose={() => setViewingShipmentId(null)} />}
    </div>
  );
}

function ShipmentCostDetails({ shipment, opportunityByCostId, onHistory, onCompare }: {
  shipment: ShipmentSummary;
  opportunityByCostId: Map<string, ReturnType<typeof calculateCostOpportunities>[number]>;
  onHistory: (cost: CostRow) => void;
  onCompare: () => void;
}) {
  if (shipment.costs.length === 0) return <div className="flex items-center justify-between"><p className="text-sm text-gray-500">Lô hàng này chưa có chi phí.</p><button type="button" onClick={onCompare} className="text-sm text-blue-600 hover:underline">So sánh lô tương tự</button></div>;
  return <div>
    <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Chi tiết của một lô hàng</p><button type="button" onClick={onCompare} className="text-xs text-blue-600 hover:underline">So sánh lô tương tự</button></div>
    <div className="space-y-2">{shipment.costs.map((cost) => {
      const opportunity = opportunityByCostId.get(cost.id);
      const spike = !!opportunity && opportunity.differencePercent >= SPIKE_DIFFERENCE_PERCENT;
      return <div key={cost.id} className={`grid items-center gap-3 rounded-lg border px-4 py-3 md:grid-cols-[1.2fr_1.5fr_1fr_1fr_1.5fr_auto] ${spike ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
        <div><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${COST_CATEGORY_BADGE_CLASS[cost.category] || "bg-gray-100 text-gray-600"}`}>{COST_CATEGORY_ICON[cost.category]} {COST_CATEGORY_LABELS[cost.category] || cost.category}</span>{cost.isAdditional && <span className="ml-1 text-[10px] text-orange-600">Phát sinh</span>}<span className={`ml-1 text-[10px] font-medium ${cost.isActual ? "text-emerald-700" : "text-amber-700"}`}>{cost.isActual ? "Thực tế" : "Dự kiến"}</span></div>
        <div className={cost.vendor ? "text-sm text-gray-700" : "text-sm font-medium text-amber-600"}>{cost.vendor?.name || "Chưa gắn nhà cung cấp"}</div>
        <div className="text-sm text-gray-600">{formatVnd(cost.unitPrice)} × {cost.quantity}</div>
        <div className="text-sm font-semibold text-gray-900">{formatVnd(cost.costPrice)}</div>
        <div className="text-xs text-gray-500">HĐ: {cost.invoiceNumber || "—"}{cost.note && <span className="block">{cost.note}</span>}{spike && <span className="block font-medium text-red-700">⚠ Cao hơn {Math.round(opportunity.differencePercent)}% · Mức tham chiếu {formatVnd(opportunity.benchmarkUnitPrice)}</span>}</div>
        <button type="button" onClick={() => onHistory(cost)} className="text-xs font-medium text-blue-600 hover:underline">Lịch sử</button>
      </div>;
    })}</div>
  </div>;
}

function Kpi({ label, value, color }: { label: string; value: string; color: "red" | "blue" | "green" | "gray" }) {
  const styles = { red: "border-red-100 bg-red-50 text-red-800", blue: "border-blue-100 bg-blue-50 text-blue-800", green: "border-emerald-100 bg-emerald-50 text-emerald-800", gray: "border-gray-200 bg-white text-gray-900" };
  return <div className={`rounded-xl border p-4 ${styles[color]}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>;
}
