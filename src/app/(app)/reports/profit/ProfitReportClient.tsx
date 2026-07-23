"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ShipmentLink from "@/components/shipments/ShipmentLink";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PERIOD_OPTIONS, generateBucketsForYear, type ReportPeriod, type Bucket } from "@/lib/report-period";

type ProfitRow = {
  id: string;
  shipmentCode: string;
  customerName: string;
  declarationNo: string | null;
  declarationDate: string;
  goodsName: string | null;
  totalRevenue: number;
  totalCost: number;
  profit: number;
};

type BucketSummary = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  totalRevenue: number;
  totalCost: number;
  profit: number;
  shipmentCount: number;
};

function formatVnd(amount: number) {
  return amount.toLocaleString("vi-VN") + " đ";
}

export default function ProfitReportClient() {
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);

  const [filters, setFilters] = useState({ customerName: "", declarationNo: "", goodsName: "" });

  useEffect(() => {
    fetch("/api/reports/profit")
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error || "Không thể tải báo cáo.");
        setRows(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra."))
      .finally(() => setIsLoading(false));
  }, []);

  function changePeriod(next: ReportPeriod) {
    setPeriod(next);
    setSelectedBucketKey(null);
  }

  function changeYear(next: number) {
    setYear(next);
    setSelectedBucketKey(null);
  }

  const bucketSummaries = useMemo<BucketSummary[]>(() => {
    let buckets: Bucket[];
    if (period === "year") {
      const years = [...new Set(rows.map((r) => new Date(r.declarationDate).getFullYear()))].sort();
      buckets = years.map((y) => ({
        key: String(y),
        label: `Năm ${y}`,
        start: new Date(y, 0, 1),
        end: new Date(y + 1, 0, 1),
      }));
    } else {
      buckets = generateBucketsForYear(period, year);
    }

    return buckets.map((bucket) => {
      const matching = rows.filter((r) => {
        const d = new Date(r.declarationDate);
        return d >= bucket.start && d < bucket.end;
      });
      return {
        ...bucket,
        totalRevenue: matching.reduce((sum, r) => sum + r.totalRevenue, 0),
        totalCost: matching.reduce((sum, r) => sum + r.totalCost, 0),
        profit: matching.reduce((sum, r) => sum + r.profit, 0),
        shipmentCount: matching.length,
      };
    });
  }, [rows, period, year]);

  const selectedBucket = bucketSummaries.find((b) => b.key === selectedBucketKey) ?? null;

  const kpiTotals = useMemo(() => {
    const source = selectedBucket ? [selectedBucket] : bucketSummaries;
    return {
      totalRevenue: source.reduce((sum, b) => sum + b.totalRevenue, 0),
      totalCost: source.reduce((sum, b) => sum + b.totalCost, 0),
      profit: source.reduce((sum, b) => sum + b.profit, 0),
      shipmentCount: source.reduce((sum, b) => sum + b.shipmentCount, 0),
    };
  }, [bucketSummaries, selectedBucket]);

  const kpiScopeLabel = selectedBucket ? selectedBucket.label : period === "year" ? "Tất cả các năm" : `Năm ${year}`;

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (selectedBucket) {
        const d = new Date(r.declarationDate);
        if (d < selectedBucket.start || d >= selectedBucket.end) return false;
      }
      if (filters.customerName && !r.customerName.toLowerCase().includes(filters.customerName.toLowerCase())) {
        return false;
      }
      if (
        filters.declarationNo &&
        !(r.declarationNo || "").toLowerCase().includes(filters.declarationNo.toLowerCase())
      ) {
        return false;
      }
      if (filters.goodsName && !(r.goodsName || "").toLowerCase().includes(filters.goodsName.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [rows, filters, selectedBucket]);

  function handleChartClick(state: { activeLabel?: string | number }) {
    if (!state || state.activeLabel === undefined) return;
    const bucket = bucketSummaries.find((b) => b.label === state.activeLabel);
    if (bucket) setSelectedBucketKey((prev) => (prev === bucket.key ? null : bucket.key));
  }

  if (isLoading) return <div className="p-8 text-gray-400">Đang tải dữ liệu...</div>;
  if (error) return <div className="p-8 text-red-600">{error}</div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/reports" className="text-sm text-blue-600 hover:underline">
          ← Quay lại báo cáo
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Báo cáo lãi lỗ</h1>
        <p className="mt-1 text-sm text-gray-500">Tổng hợp thu, chi phí và lãi/lỗ theo lô hàng.</p>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Tổng thu ({kpiScopeLabel})</p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">{formatVnd(kpiTotals.totalRevenue)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Tổng chi phí ({kpiScopeLabel})</p>
          <p className="mt-1 text-2xl font-semibold text-orange-600">{formatVnd(kpiTotals.totalCost)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Lãi/Lỗ ({kpiScopeLabel})</p>
          <p className={`mt-1 text-2xl font-semibold ${kpiTotals.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
            {formatVnd(kpiTotals.profit)}
          </p>
          <p className="mt-1 text-xs text-gray-400">{kpiTotals.shipmentCount} lô hàng</p>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Tổng hợp theo thời gian</h2>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 rounded-md border border-gray-200 p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changePeriod(option.value)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  period === option.value ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {period !== "year" && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => changeYear(year - 1)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
              >
                ‹
              </button>
              <span className="text-sm font-medium text-gray-900">Năm {year}</span>
              <button
                type="button"
                onClick={() => changeYear(year + 1)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50"
              >
                ›
              </button>
            </div>
          )}

          {selectedBucket && (
            <button
              type="button"
              onClick={() => setSelectedBucketKey(null)}
              className="text-sm text-gray-500 hover:underline"
            >
              Xóa lọc theo kỳ ({selectedBucket.label})
            </button>
          )}
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bucketSummaries} onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => (v / 1_000_000).toLocaleString("vi-VN")} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => formatVnd(Number(value))} />
              <Legend />
              <Bar dataKey="totalRevenue" name="Tổng thu" fill="#2563eb" cursor="pointer">
                <LabelList
                  dataKey="totalRevenue"
                  position="top"
                  fontSize={9}
                  fill="#2563eb"
                  formatter={(value: unknown) => (typeof value === "number" && value ? value.toLocaleString("vi-VN") : "")}
                />
              </Bar>
              <Bar dataKey="totalCost" name="Tổng chi phí" fill="#f97316" cursor="pointer">
                <LabelList
                  dataKey="totalCost"
                  position="top"
                  fontSize={9}
                  fill="#f97316"
                  formatter={(value: unknown) => (typeof value === "number" && value ? value.toLocaleString("vi-VN") : "")}
                />
              </Bar>
              <Bar dataKey="profit" name="Lãi/Lỗ" fill="#16a34a" cursor="pointer">
                <LabelList
                  dataKey="profit"
                  position="top"
                  fontSize={9}
                  fill="#16a34a"
                  formatter={(value: unknown) => (typeof value === "number" && value ? value.toLocaleString("vi-VN") : "")}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Kỳ</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tổng thu</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tổng chi phí</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Lãi/Lỗ</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Số lô hàng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bucketSummaries.map((bucket) => (
                <tr
                  key={bucket.key}
                  onClick={() => setSelectedBucketKey((prev) => (prev === bucket.key ? null : bucket.key))}
                  className={`cursor-pointer hover:bg-gray-50 ${
                    selectedBucketKey === bucket.key ? "bg-blue-50" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-gray-900">{bucket.label}</td>
                  <td className="px-3 py-2 text-gray-600">{formatVnd(bucket.totalRevenue)}</td>
                  <td className="px-3 py-2 text-gray-600">{formatVnd(bucket.totalCost)}</td>
                  <td className={`px-3 py-2 font-medium ${bucket.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {formatVnd(bucket.profit)}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{bucket.shipmentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">Chi tiết lô hàng</h2>
        <div className="mb-3 flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Lọc theo khách hàng..."
            value={filters.customerName}
            onChange={(e) => setFilters((prev) => ({ ...prev, customerName: e.target.value }))}
            className="input max-w-xs"
          />
          <input
            type="text"
            placeholder="Lọc theo số tờ khai..."
            value={filters.declarationNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, declarationNo: e.target.value }))}
            className="input max-w-xs"
          />
          <input
            type="text"
            placeholder="Lọc theo tên hàng..."
            value={filters.goodsName}
            onChange={(e) => setFilters((prev) => ({ ...prev, goodsName: e.target.value }))}
            className="input max-w-xs"
          />
        </div>

        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Khách hàng</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Số tờ khai</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Ngày tờ khai</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tên hàng</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tổng thu</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tổng chi phí</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Lãi/Lỗ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    Không có lô hàng khớp bộ lọc.
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <ShipmentLink shipmentId={row.id} className="font-medium text-blue-600 hover:underline">
                      {row.customerName}
                    </ShipmentLink>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.declarationNo || "—"}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {new Date(row.declarationDate).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.goodsName || "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{formatVnd(row.totalRevenue)}</td>
                  <td className="px-3 py-2 text-gray-600">{formatVnd(row.totalCost)}</td>
                  <td className={`px-3 py-2 font-medium ${row.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                    {formatVnd(row.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
