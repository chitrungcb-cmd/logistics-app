"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { downloadExcel } from "@/lib/export-excel";
import { COST_CATEGORY_LABELS, COST_CATEGORY_OPTIONS } from "@/lib/shipment-cost-constants";

type DetailRow = {
  costId: string;
  shipmentId: string;
  declarationNo: string | null;
  declarationDate: string | null;
  customerName: string;
  goodsName: string | null;
  category: string;
  categoryLabel: string;
  amount: number;
  invoiceNumber: string | null;
  accountingDate: string;
};

type VendorRow = {
  vendorId: string | null;
  vendorName: string;
  vendorType: string | null;
  shipmentCount: number;
  lineCount: number;
  totalPayable: number;
  details: DetailRow[];
};

type ReportData = {
  month: string;
  rows: VendorRow[];
  totals: {
    vendorCount: number;
    shipmentCount: number;
    lineCount: number;
    totalPayable: number;
    unassignedLineCount: number;
    unassignedAmount: number;
  };
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatVnd(amount: number) {
  return `${amount.toLocaleString("vi-VN")} đ`;
}

export default function VendorPayablesReportClient() {
  const [month, setMonth] = useState(currentMonth);
  const [category, setCategory] = useState("");
  const [data, setData] = useState<ReportData | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ month });
    if (category) params.set("category", category);
    fetch(`/api/reports/vendor-payables?${params}`)
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
  }, [month, category]);

  const hasUnassigned = (data?.totals.unassignedLineCount ?? 0) > 0;
  const detailCount = useMemo(() => data?.rows.reduce((sum, row) => sum + row.details.length, 0) ?? 0, [data]);

  async function exportExcel() {
    if (!data) return;
    const summary = data.rows.map((row, index) => ({
      STT: index + 1,
      "Nhà cung cấp": row.vendorName,
      "Loại đối tác": row.vendorType || "",
      "Số lô": row.shipmentCount,
      "Số khoản": row.lineCount,
      "Tổng phải trả": row.totalPayable,
    }));
    const details = data.rows.flatMap((row) =>
      row.details.map((detail) => ({
        "Nhà cung cấp": row.vendorName,
        "Số tờ khai": detail.declarationNo || "",
        "Ngày tờ khai": detail.declarationDate ? new Date(detail.declarationDate).toLocaleDateString("vi-VN") : "",
        "Khách hàng": detail.customerName,
        "Tên hàng": detail.goodsName || "",
        "Hạng mục": detail.categoryLabel,
        "Số hóa đơn": detail.invoiceNumber || "",
        "Số tiền": detail.amount,
      }))
    );
    await downloadExcel(`phai-tra-nha-cung-cap-${month}.xlsx`, [
      { name: "Tổng hợp nhà cung cấp", rows: summary },
      { name: "Chi tiết lô hàng", rows: details },
    ]);
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/reports" className="text-sm text-blue-600 hover:underline">← Quay lại báo cáo</Link>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Phải trả nhà cung cấp</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tổng hợp chi phí đã xác nhận theo công ty và số lô. Ưu tiên ngày tờ khai; lô chưa có tờ khai dùng ngày tạo chi phí.
          </p>
        </div>
        <button type="button" onClick={exportExcel} disabled={!data || detailCount === 0} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          📊 Xuất Excel
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Tháng báo cáo</span>
          <input type="month" value={month} onChange={(event) => { setIsLoading(true); setError(null); setMonth(event.target.value); }} className="input w-48" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Hạng mục</span>
          <select value={category} onChange={(event) => { setIsLoading(true); setError(null); setCategory(event.target.value); }} className="input min-w-56">
            <option value="">Tất cả hạng mục</option>
            {COST_CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{COST_CATEGORY_LABELS[item]}</option>)}
          </select>
        </label>
      </div>

      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Nhà cung cấp" value={String(data.totals.vendorCount)} note="Có phát sinh trong tháng" />
          <Metric label="Số lô" value={String(data.totals.shipmentCount)} note={`${data.totals.lineCount} khoản chi phí`} />
          <Metric label="Tổng phải trả" value={formatVnd(data.totals.totalPayable)} note="Theo chi phí đã xác nhận" accent="blue" />
          <Metric label="Chưa gắn nhà cung cấp" value={formatVnd(data.totals.unassignedAmount)} note={`${data.totals.unassignedLineCount} khoản cần bổ sung`} accent={hasUnassigned ? "amber" : "default"} />
        </div>
      )}

      {error && <p className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50"><tr>
            <th className="w-16 px-4 py-3 text-center font-medium text-gray-500">STT</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Nhà cung cấp</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Loại đối tác</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Số lô</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Số khoản</th>
            <th className="px-4 py-3 text-right font-medium text-gray-500">Tổng phải trả</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Đang tổng hợp báo cáo...</td></tr>}
            {!isLoading && !error && (!data || data.rows.length === 0) && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Chưa có chi phí trong tháng này.</td></tr>}
            {!isLoading && data?.rows.map((row, index) => {
              const key = row.vendorId || "__UNASSIGNED__";
              const expanded = expandedKey === key;
              return [
                <tr key={key} className={row.vendorId ? "hover:bg-gray-50" : "bg-amber-50"}>
                  <td className="px-4 py-3 text-center text-gray-500">{index + 1}</td>
                  <td className={`px-4 py-3 font-medium ${row.vendorId ? "text-gray-900" : "text-amber-700"}`}>{row.vendorName}</td>
                  <td className="px-4 py-3 text-gray-500">{row.vendorType || "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{row.shipmentCount}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{row.lineCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">{formatVnd(row.totalPayable)}</td>
                  <td className="px-4 py-3 text-right"><button type="button" onClick={() => setExpandedKey(expanded ? null : key)} className="font-medium text-blue-600 hover:underline">{expanded ? "Thu gọn" : "Xem các lô"}</button></td>
                </tr>,
                expanded ? <tr key={`${key}-details`}><td colSpan={7} className="bg-gray-50 px-5 py-4"><DetailTable details={row.details} /></td></tr> : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailTable({ details }: { details: DetailRow[] }) {
  return <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white"><table className="min-w-full divide-y divide-gray-100 text-xs">
    <thead className="bg-gray-50"><tr><th className="px-3 py-2 text-left text-gray-500">Số TK</th><th className="px-3 py-2 text-left text-gray-500">Khách hàng / tên hàng</th><th className="px-3 py-2 text-left text-gray-500">Hạng mục</th><th className="px-3 py-2 text-left text-gray-500">Số HĐ</th><th className="px-3 py-2 text-right text-gray-500">Phải trả</th><th></th></tr></thead>
    <tbody className="divide-y divide-gray-100">{details.map((detail) => <tr key={detail.costId}>
      <td className="px-3 py-2"><Link href={`/shipments/${detail.shipmentId}`} className="font-medium text-blue-600 hover:underline">{detail.declarationNo || "Chưa có TK"}</Link><span className="block text-gray-400">{new Date(detail.accountingDate).toLocaleDateString("vi-VN")}</span></td>
      <td className="px-3 py-2 text-gray-700">{detail.customerName}<span className="block text-gray-400">{detail.goodsName || "Chưa có tên hàng"}</span></td>
      <td className="px-3 py-2 text-gray-600">{detail.categoryLabel}</td><td className="px-3 py-2 text-gray-600">{detail.invoiceNumber || "—"}</td><td className="px-3 py-2 text-right font-medium text-gray-900">{formatVnd(detail.amount)}</td>
      <td className="px-3 py-2 text-right"><Link href={`/costs?shipmentId=${detail.shipmentId}`} className="text-blue-600 hover:underline">Mở chi phí</Link></td>
    </tr>)}</tbody>
  </table></div>;
}

function Metric({ label, value, note, accent = "default" }: { label: string; value: string; note: string; accent?: "default" | "blue" | "amber" }) {
  const colors = accent === "blue" ? "border-blue-200 bg-blue-50 text-blue-800" : accent === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-gray-200 bg-white text-gray-900";
  return <div className={`rounded-xl border p-4 ${colors}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p><p className="mt-1 text-xs opacity-60">{note}</p></div>;
}
