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
  totalRevenueGross: number;
  totalRevenueNet: number;
  outputVat: number;
  totalCostGross: number;
  totalCostNet: number;
  inputVat: number;
  profitGross: number;
  profitNet: number;
  revenueVatSeparated: boolean;
};

type BucketSummary = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  totalRevenue: number;
  totalCost: number;
  profit: number;
  totalRevenueGross: number;
  totalRevenueNet: number;
  outputVat: number;
  totalCostGross: number;
  totalCostNet: number;
  inputVat: number;
  profitGross: number;
  profitNet: number;
  shipmentCount: number;
  unseparatedRevenueVatCount: number;
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
        // Biểu đồ chính dùng số chưa VAT/lợi nhuận trước VAT. Các số gồm VAT vẫn được tổng hợp
        // riêng ở khối đối chiếu bên trên để không nhầm doanh thu kế toán với dòng tiền.
        totalRevenue: matching.reduce((sum, r) => sum + r.totalRevenueNet, 0),
        totalCost: matching.reduce((sum, r) => sum + r.totalCostNet, 0),
        profit: matching.reduce((sum, r) => sum + r.profitNet, 0),
        totalRevenueGross: matching.reduce((sum, r) => sum + r.totalRevenueGross, 0),
        totalRevenueNet: matching.reduce((sum, r) => sum + r.totalRevenueNet, 0),
        outputVat: matching.reduce((sum, r) => sum + r.outputVat, 0),
        totalCostGross: matching.reduce((sum, r) => sum + r.totalCostGross, 0),
        totalCostNet: matching.reduce((sum, r) => sum + r.totalCostNet, 0),
        inputVat: matching.reduce((sum, r) => sum + r.inputVat, 0),
        profitGross: matching.reduce((sum, r) => sum + r.profitGross, 0),
        profitNet: matching.reduce((sum, r) => sum + r.profitNet, 0),
        shipmentCount: matching.length,
        unseparatedRevenueVatCount: matching.filter((r) => !r.revenueVatSeparated).length,
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
      totalRevenueGross: source.reduce((sum, b) => sum + b.totalRevenueGross, 0),
      totalRevenueNet: source.reduce((sum, b) => sum + b.totalRevenueNet, 0),
      outputVat: source.reduce((sum, b) => sum + b.outputVat, 0),
      totalCostGross: source.reduce((sum, b) => sum + b.totalCostGross, 0),
      totalCostNet: source.reduce((sum, b) => sum + b.totalCostNet, 0),
      inputVat: source.reduce((sum, b) => sum + b.inputVat, 0),
      profitGross: source.reduce((sum, b) => sum + b.profitGross, 0),
      profitNet: source.reduce((sum, b) => sum + b.profitNet, 0),
      shipmentCount: source.reduce((sum, b) => sum + b.shipmentCount, 0),
      unseparatedRevenueVatCount: source.reduce((sum, b) => sum + b.unseparatedRevenueVatCount, 0),
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

      <section className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Doanh thu chưa VAT ({kpiScopeLabel})</p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">{formatVnd(kpiTotals.totalRevenueNet)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Chi phí chưa VAT ({kpiScopeLabel})</p>
          <p className="mt-1 text-2xl font-semibold text-orange-600">{formatVnd(kpiTotals.totalCostNet)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Lợi nhuận trước VAT ({kpiScopeLabel})</p>
          <p className={`mt-1 text-2xl font-semibold ${kpiTotals.profitNet >= 0 ? "text-green-700" : "text-red-600"}`}>
            {formatVnd(kpiTotals.profitNet)}
          </p>
          <p className="mt-1 text-xs text-gray-400">{kpiTotals.shipmentCount} lô hàng</p>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm lg:grid-cols-5">
        <div><p className="text-gray-500">Khách trả (gồm VAT)</p><p className="mt-1 font-semibold">{formatVnd(kpiTotals.totalRevenueGross)}</p></div>
        <div><p className="text-gray-500">VAT đầu ra</p><p className="mt-1 font-semibold text-blue-700">{formatVnd(kpiTotals.outputVat)}</p></div>
        <div><p className="text-gray-500">Đã chi (gồm VAT)</p><p className="mt-1 font-semibold">{formatVnd(kpiTotals.totalCostGross)}</p></div>
        <div><p className="text-gray-500">VAT đầu vào đã khớp</p><p className="mt-1 font-semibold text-green-700">{formatVnd(kpiTotals.inputVat)}</p></div>
        <div><p className="text-gray-500">Chênh lệch tiền gồm VAT</p><p className={`mt-1 font-semibold ${kpiTotals.profitGross >= 0 ? "text-green-700" : "text-red-600"}`}>{formatVnd(kpiTotals.profitGross)}</p></div>
      </section>

      {kpiTotals.unseparatedRevenueVatCount > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Có {kpiTotals.unseparatedRevenueVatCount} lô chưa tách VAT đầu ra. Với các lô này, hệ thống đang tạm xem
          tổng thu là doanh thu chưa VAT; hãy bổ sung hóa đơn hoặc phân tách báo giá để báo cáo thuế chính xác hoàn toàn.
        </div>
      )}

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
              <Bar dataKey="totalRevenue" name="Doanh thu chưa VAT" fill="#2563eb" cursor="pointer">
                <LabelList
                  dataKey="totalRevenue"
                  position="top"
                  fontSize={9}
                  fill="#2563eb"
                  formatter={(value: unknown) => (typeof value === "number" && value ? value.toLocaleString("vi-VN") : "")}
                />
              </Bar>
              <Bar dataKey="totalCost" name="Chi phí chưa VAT" fill="#f97316" cursor="pointer">
                <LabelList
                  dataKey="totalCost"
                  position="top"
                  fontSize={9}
                  fill="#f97316"
                  formatter={(value: unknown) => (typeof value === "number" && value ? value.toLocaleString("vi-VN") : "")}
                />
              </Bar>
              <Bar dataKey="profit" name="Lợi nhuận trước VAT" fill="#16a34a" cursor="pointer">
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
                <th className="px-3 py-2 text-left font-medium text-gray-500">Doanh thu chưa VAT</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Chi phí chưa VAT</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Lợi nhuận trước VAT</th>
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
                <th className="px-3 py-2 text-left font-medium text-gray-500">Doanh thu</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Chi phí</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Lợi nhuận</th>
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
                  <td className="px-3 py-2 text-gray-600">
                    <p className="font-medium text-gray-900">Chưa VAT: {formatVnd(row.totalRevenueNet)}</p>
                    <p className="text-xs">VAT: {formatVnd(row.outputVat)}</p>
                    <p className="text-xs">Khách trả: {formatVnd(row.totalRevenueGross)}</p>
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <p className="font-medium text-gray-900">Chưa VAT: {formatVnd(row.totalCostNet)}</p>
                    <p className="text-xs">VAT đã khớp: {formatVnd(row.inputVat)}</p>
                    <p className="text-xs">Đã chi: {formatVnd(row.totalCostGross)}</p>
                  </td>
                  <td className={`px-3 py-2 font-medium ${row.profitNet >= 0 ? "text-green-700" : "text-red-600"}`}>
                    <p>Trước VAT: {formatVnd(row.profitNet)}</p>
                    <p className="text-xs font-normal text-gray-500">Tiền gồm VAT: {formatVnd(row.profitGross)}</p>
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
