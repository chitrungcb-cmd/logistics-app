"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ShipmentLink from "@/components/shipments/ShipmentLink";
import { downloadExcel } from "@/lib/export-excel";
import { COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";
import type { CostVarianceSeverity } from "@/lib/cost-variance-report";

type Detail = {
  id: string;
  shipmentId: string;
  category: string;
  customLabel: string | null;
  unit: string | null;
  unitPrice: number;
  quantity: number;
  costPrice: number;
  vendorName: string | null;
  declarationNo: string | null;
  declarationDate: string | null;
  customerName: string;
  goodsName: string | null;
  port: string | null;
  differenceFromMedian: number;
  differencePercent: number;
};

type VarianceRow = {
  key: string;
  goodsKeyword: string;
  category: string;
  categoryLabel: string;
  unit: string;
  shipmentCount: number;
  lineCount: number;
  minUnitPrice: number;
  medianUnitPrice: number;
  averageUnitPrice: number;
  maxUnitPrice: number;
  varianceAmount: number;
  variancePercent: number;
  potentialSaving: number;
  severity: CostVarianceSeverity;
  details: Detail[];
};

type ReportData = {
  rows: VarianceRow[];
  totals: {
    groupCount: number;
    shipmentCount: number;
    lineCount: number;
    maxVariancePercent: number;
    potentialSaving: number;
  };
};

function formatVnd(amount: number) {
  return `${Math.round(amount).toLocaleString("vi-VN")} đ`;
}

function formatPercent(value: number) {
  return `${Math.round(value).toLocaleString("vi-VN")}%`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}

export default function CostVarianceReportClient() {
  const [category, setCategory] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minVariancePercent, setMinVariancePercent] = useState("30");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ minVariancePercent });
    if (category) params.set("category", category);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    fetch(`/api/reports/cost-variance?${params}`, { cache: "no-store" })
      .then((response) => response.json().then((json) => ({ response, json })))
      .then(({ response, json }) => {
        if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải báo cáo.");
        if (!cancelled) setData(json.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Không thể tải báo cáo.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, dateFrom, dateTo, minVariancePercent]);

  const rows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    if (!keyword) return data?.rows ?? [];
    return (data?.rows ?? []).filter((row) =>
      [row.goodsKeyword, row.categoryLabel, ...row.details.flatMap((detail) => [
        detail.goodsName,
        detail.customerName,
        detail.declarationNo,
        detail.vendorName,
        detail.port,
      ])]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("vi").includes(keyword))
    );
  }, [data, query]);
  const visibleTotals = useMemo(() => ({
    groupCount: rows.length,
    shipmentCount: new Set(rows.flatMap((row) => row.details.map((detail) => detail.shipmentId))).size,
    lineCount: rows.reduce((sum, row) => sum + row.lineCount, 0),
    maxVariancePercent: rows.reduce((max, row) => Math.max(max, row.variancePercent), 0),
    potentialSaving: rows.reduce((sum, row) => sum + row.potentialSaving, 0),
  }), [rows]);

  async function exportExcel() {
    if (!data) return;
    const summary = rows.map((row, index) => ({
      STT: index + 1,
      "Nhóm hàng": row.goodsKeyword,
      "Hạng mục": row.categoryLabel,
      "Đơn vị": row.unit,
      "Số lô": row.shipmentCount,
      "Giá thấp nhất": row.minUnitPrice,
      "Giá trung vị": row.medianUnitPrice,
      "Giá cao nhất": row.maxUnitPrice,
      "Chênh lệch": row.varianceAmount,
      "Tỷ lệ chênh": row.variancePercent,
      "Ước tính có thể tiết kiệm": row.potentialSaving,
    }));
    const details = rows.flatMap((row) =>
      row.details.map((detail) => ({
        "Nhóm hàng": row.goodsKeyword,
        "Hạng mục": row.categoryLabel,
        "Số tờ khai": detail.declarationNo || "",
        "Ngày tờ khai": formatDate(detail.declarationDate),
        "Khách hàng": detail.customerName,
        "Tên hàng": detail.goodsName || "",
        "Cửa khẩu": detail.port || "",
        "Nhà cung cấp": detail.vendorName || "",
        "Đơn giá": detail.unitPrice,
        "Số lượng": detail.quantity,
        "ĐVT": detail.unit || "Lô",
        "Thành tiền": detail.costPrice,
        "So với trung vị": detail.differenceFromMedian,
        "Tỷ lệ so với trung vị": detail.differencePercent,
      }))
    );
    await downloadExcel(`so-sanh-chenh-lech-chi-phi-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Nhóm chênh lệch", rows: summary },
      { name: "Chi tiết từng lô", rows: details },
    ]);
  }

  function refreshFilter(change: () => void) {
    setIsLoading(true);
    setError(null);
    setExpandedKey(null);
    change();
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Quay lại báo cáo</Link>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">So sánh chênh lệch chi phí</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            So sánh chi phí thực tế giữa các lô cùng nhóm hàng, cùng hạng mục và cùng đơn vị tính để phát hiện giá bất thường.
          </p>
        </div>
        <button type="button" onClick={exportExcel} disabled={rows.length === 0} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          📊 Xuất Excel
        </button>
      </div>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="input xl:col-span-2" placeholder="Tìm nhóm hàng, công ty, số TK, NCC..." />
          <select value={category} onChange={(event) => refreshFilter(() => setCategory(event.target.value))} className="input">
            <option value="">Tất cả hạng mục</option>
            {COST_CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{COST_CATEGORY_LABELS[item]}</option>)}
          </select>
          <select value={minVariancePercent} onChange={(event) => refreshFilter(() => setMinVariancePercent(event.target.value))} className="input">
            <option value="20">Chênh từ 20%</option>
            <option value="30">Chênh từ 30%</option>
            <option value="50">Chênh từ 50%</option>
            <option value="100">Chênh từ 100%</option>
          </select>
          <input type="date" value={dateFrom} onChange={(event) => refreshFilter(() => setDateFrom(event.target.value))} className="input" title="Từ ngày tờ khai" />
          <input type="date" value={dateTo} onChange={(event) => refreshFilter(() => setDateTo(event.target.value))} className="input" title="Đến ngày tờ khai" />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Cách tính: (giá cao nhất − giá thấp nhất) / giá thấp nhất. Chỉ so sánh khi có ít nhất 2 lô khác nhau.
        </p>
      </section>

      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Nhóm cần rà soát" value={String(visibleTotals.groupCount)} note={`${visibleTotals.lineCount} khoản thuộc ${visibleTotals.shipmentCount} lô`} />
          <Metric label="Chênh lệch lớn nhất" value={formatPercent(visibleTotals.maxVariancePercent)} note="So giữa giá cao nhất và thấp nhất" accent="red" />
          <Metric label="Ước tính có thể tiết kiệm" value={formatVnd(visibleTotals.potentialSaving)} note="Phần cao hơn mức giá trung vị" accent="green" />
          <Metric label="Ngưỡng đang lọc" value={`Từ ${minVariancePercent}%`} note={query ? "Đã tính lại theo từ khóa tìm kiếm" : "Có thể đổi tại bộ lọc phía trên"} accent="blue" />
        </div>
      )}

      {error && <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-[1180px] divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="w-14 px-4 py-3 text-center font-medium text-gray-500">STT</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Nhóm hàng / hạng mục</th>
            <th className="px-4 py-3 text-center font-medium text-gray-500">Số lô</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Giá thấp nhất</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Giá trung vị</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Giá cao nhất</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Chênh lệch</th>
            <th className="px-4 py-3 text-center font-medium text-gray-500">Mức cảnh báo</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Đang phân tích chi phí...</td></tr>}
            {!isLoading && !error && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">Không có nhóm chi phí nào vượt mức chênh lệch đã chọn.</td></tr>}
            {!isLoading && rows.map((row, index) => {
              const expanded = expandedKey === row.key;
              return (
                <Fragment key={row.key}>
                  <tr className={row.severity === "VERY_HIGH" ? "bg-red-50/60" : "hover:bg-gray-50"}>
                    <td className="px-4 py-3 text-center text-gray-500">{index + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{row.goodsKeyword}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{row.categoryLabel} · tính theo {row.unit}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">{row.shipmentCount}<span className="block text-[11px] text-gray-400">{row.lineCount} khoản</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-emerald-700">{formatVnd(row.minUnitPrice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-gray-700">{formatVnd(row.medianUnitPrice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-red-700">{formatVnd(row.maxUnitPrice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right"><span className="font-semibold text-red-700">+{formatVnd(row.varianceAmount)}</span><span className="block text-xs text-red-600">+{formatPercent(row.variancePercent)}</span></td>
                    <td className="px-4 py-3 text-center"><SeverityBadge severity={row.severity} /></td>
                    <td className="px-4 py-3 text-right"><button type="button" onClick={() => setExpandedKey(expanded ? null : row.key)} className="font-medium text-blue-600 hover:underline">{expanded ? "Thu gọn" : "Xem từng lô"}</button></td>
                  </tr>
                  {expanded && <tr><td colSpan={9} className="bg-slate-50 px-5 py-4"><VarianceDetails row={row} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VarianceDetails({ row }: { row: VarianceRow }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Chi tiết đơn giá từng lô</p>
        <p className="text-xs text-gray-500">Mức tham chiếu: trung vị {formatVnd(row.medianUnitPrice)} / {row.unit}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-[1050px] divide-y divide-gray-100 text-xs">
          <thead className="bg-gray-50"><tr>
            <th className="px-3 py-2 text-left text-gray-500">Số TK / ngày TK</th>
            <th className="px-3 py-2 text-left text-gray-500">Khách hàng / tên hàng</th>
            <th className="px-3 py-2 text-left text-gray-500">Cửa khẩu</th>
            <th className="px-3 py-2 text-left text-gray-500">Nhà cung cấp</th>
            <th className="px-3 py-2 text-right text-gray-500">Đơn giá</th>
            <th className="px-3 py-2 text-right text-gray-500">SL / thành tiền</th>
            <th className="px-3 py-2 text-right text-gray-500">So với trung vị</th>
            <th></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {row.details.map((detail) => (
              <tr key={detail.id} className={detail.unitPrice === row.maxUnitPrice ? "bg-red-50" : detail.unitPrice === row.minUnitPrice ? "bg-emerald-50" : ""}>
                <td className="px-3 py-2"><ShipmentLink shipmentId={detail.shipmentId} className="font-semibold text-blue-600 hover:underline">{detail.declarationNo || "Chưa có TK"}</ShipmentLink><span className="block text-gray-400">{formatDate(detail.declarationDate)}</span></td>
                <td className="max-w-xs px-3 py-2 text-gray-700">{detail.customerName}<span className="block truncate text-gray-400">{detail.goodsName || "Chưa có tên hàng"}</span></td>
                <td className="px-3 py-2 text-gray-600">{detail.port || "—"}</td>
                <td className={`px-3 py-2 ${detail.vendorName ? "text-gray-600" : "text-amber-600"}`}>{detail.vendorName || "Chưa gắn NCC"}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${detail.unitPrice === row.maxUnitPrice ? "text-red-700" : detail.unitPrice === row.minUnitPrice ? "text-emerald-700" : "text-gray-900"}`}>{formatVnd(detail.unitPrice)} / {detail.unit || "Lô"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-gray-600">{detail.quantity.toLocaleString("vi-VN")} · {formatVnd(detail.costPrice)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${detail.differenceFromMedian > 0 ? "text-red-600" : detail.differenceFromMedian < 0 ? "text-emerald-700" : "text-gray-500"}`}>{detail.differenceFromMedian > 0 ? "+" : ""}{formatVnd(detail.differenceFromMedian)}<span className="block">{detail.differencePercent > 0 ? "+" : ""}{formatPercent(detail.differencePercent)}</span></td>
                <td className="px-3 py-2 text-right"><Link href={`/costs?shipmentId=${detail.shipmentId}`} className="text-blue-600 hover:underline">Mở chi phí</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: CostVarianceSeverity }) {
  const styles = severity === "VERY_HIGH"
    ? "bg-red-100 text-red-800"
    : severity === "HIGH"
      ? "bg-orange-100 text-orange-800"
      : "bg-amber-100 text-amber-800";
  const label = severity === "VERY_HIGH" ? "Rất cao" : severity === "HIGH" ? "Cao" : "Cần xem";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${styles}`}>{label}</span>;
}

function Metric({ label, value, note, accent = "default" }: { label: string; value: string; note: string; accent?: "default" | "blue" | "green" | "red" }) {
  const styles = {
    default: "border-gray-200 bg-white text-gray-900",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };
  return <div className={`rounded-xl border p-4 ${styles[accent]}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p><p className="mt-1 text-xs opacity-60">{note}</p></div>;
}
