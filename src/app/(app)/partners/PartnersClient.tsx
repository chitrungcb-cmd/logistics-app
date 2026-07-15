"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import GmailSyncPanel from "@/components/shipments/GmailSyncPanel";

type InvoiceStatus = "MATCHED" | "UNMATCHED" | "NEEDS_REVIEW";

type InvoiceRow = {
  id: string;
  sellerName: string | null;
  sellerTaxCode: string | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  isIssuedToNq: boolean | null;
  invoiceNumber: string | null;
  invoiceSymbol: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  currency: string;
  attachmentName: string;
  attachmentUrl: string;
  xmlUrl: string | null;
  pdfUrl: string | null;
  status: InvoiceStatus;
  note: string | null;
  vendor: { id: string; name: string; taxCode: string | null; type: string | null } | null;
  shipmentCost: {
    id: string;
    category: string;
    costPrice: number;
    invoiceNumber: string | null;
    shipment: {
      id: string;
      declarationNo: string | null;
      declarationDate: string | null;
      goodsName: string | null;
      customerName: string;
    };
  } | null;
};

type PartnerRow = {
  id: string;
  name: string;
  taxCode: string | null;
  type: string | null;
  phone: string | null;
  invoiceCount: number;
  matchedCount: number;
  totalAmount: number;
};

type InvoiceData = {
  invoices: InvoiceRow[];
  totals: { count: number; matched: number; unmatched: number; needsReview: number; totalAmount: number };
  partners: PartnerRow[];
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMoney(amount: number | null, currency = "VND") {
  if (amount === null) return "—";
  if (currency === "VND") return `${amount.toLocaleString("vi-VN")} đ`;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(amount);
}

function StatusBadge({ invoice }: { invoice: InvoiceRow }) {
  if (invoice.isIssuedToNq === false) {
    return <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">Không phải NQ</span>;
  }
  if (invoice.status === "MATCHED") {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">✓ Đã khớp chi phí</span>;
  }
  if (invoice.status === "UNMATCHED") {
    return <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Chưa khớp chi phí</span>;
  }
  return <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">Cần kiểm tra</span>;
}

export default function PartnersClient({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<"invoices" | "partners">("invoices");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState("");
  const [data, setData] = useState<InvoiceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (month) params.set("month", month);
      if (status) params.set("status", status);
      const response = await fetch(`/api/vendor-invoices?${params}`, { cache: "no-store" });
      const text = await response.text();
      if (!text) throw new Error(`Máy chủ không trả về dữ liệu (HTTP ${response.status}).`);
      const json = JSON.parse(text);
      if (!response.ok || !json.success) throw new Error(json.error || "Không thể tải hóa đơn đối tác.");
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải hóa đơn đối tác.");
    } finally {
      setIsLoading(false);
    }
  }, [month, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 250);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const pending = (data?.totals.unmatched ?? 0) + (data?.totals.needsReview ?? 0);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Đối tác & hóa đơn đầu vào</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tự đọc hóa đơn XML/PDF trong Gmail, lấy thông tin nhà cung cấp và đối chiếu với chi phí theo số hóa đơn.
        </p>
      </div>

      {isAdmin && <GmailSyncPanel onSynced={loadData} />}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Hóa đơn đã nhận" value={String(data?.totals.count ?? 0)} note="Theo bộ lọc hiện tại" />
        <Metric label="Đã đối chiếu" value={String(data?.totals.matched ?? 0)} note="Đã ghép đúng khoản chi" accent="green" />
        <Metric label="Chờ xử lý" value={String(pending)} note="Chưa khớp hoặc cần kiểm tra" accent={pending > 0 ? "amber" : "default"} />
        <Metric label="Tổng tiền hóa đơn" value={formatMoney(data?.totals.totalAmount ?? 0)} note="Không cộng hóa đơn xác định không phải NQ" accent="blue" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
            <button type="button" onClick={() => setTab("invoices")} className={`rounded-md px-4 py-2 font-medium ${tab === "invoices" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>Hóa đơn đối chiếu</button>
            <button type="button" onClick={() => setTab("partners")} className={`rounded-md px-4 py-2 font-medium ${tab === "partners" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>Danh sách đối tác</button>
          </div>
          {tab === "invoices" && (
            <div className="flex flex-wrap gap-3">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên đối tác, MST, số hóa đơn, số TK..." className="input w-72" />
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="input w-44" />
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="input w-48">
                <option value="">Tất cả trạng thái</option>
                <option value="MATCHED">Đã khớp chi phí</option>
                <option value="UNMATCHED">Chưa khớp chi phí</option>
                <option value="NEEDS_REVIEW">Cần kiểm tra</option>
              </select>
            </div>
          )}
        </div>

        {error && <p className="m-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {tab === "invoices" ? (
          <InvoiceTable rows={data?.invoices ?? []} isLoading={isLoading} />
        ) : (
          <PartnerTable rows={data?.partners ?? []} isLoading={isLoading} />
        )}
      </div>
    </div>
  );
}

function InvoiceTable({ rows, isLoading }: { rows: InvoiceRow[]; isLoading: boolean }) {
  return <div className="overflow-x-auto"><table className="min-w-[1180px] w-full divide-y divide-gray-200 text-sm">
    <thead className="bg-gray-50"><tr>
      <th className="w-14 px-4 py-3 text-center font-medium text-gray-500">STT</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Ngày / số hóa đơn</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Đối tác xuất hóa đơn</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Xuất cho</th>
      <th className="px-4 py-3 text-right font-medium text-gray-500">Tổng tiền</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Đối chiếu</th>
      <th className="px-4 py-3 text-left font-medium text-gray-500">Lô hàng / chi phí</th>
      <th className="px-4 py-3 text-right font-medium text-gray-500">File</th>
    </tr></thead>
    <tbody className="divide-y divide-gray-100">
      {isLoading && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Đang kiểm tra hóa đơn...</td></tr>}
      {!isLoading && rows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Chưa có hóa đơn phù hợp. Hệ thống sẽ tự kiểm tra Gmail mỗi 5 phút.</td></tr>}
      {!isLoading && rows.map((invoice, index) => <tr key={invoice.id} className="align-top hover:bg-gray-50">
        <td className="px-4 py-4 text-center text-gray-400">{index + 1}</td>
        <td className="px-4 py-4"><p className="font-medium text-gray-900">{invoice.invoiceNumber || "Chưa đọc được số HĐ"}</p><p className="mt-1 text-xs text-gray-500">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString("vi-VN") : "Chưa có ngày"}{invoice.invoiceSymbol ? ` · ${invoice.invoiceSymbol}` : ""}</p></td>
        <td className="px-4 py-4"><p className="max-w-64 font-medium text-gray-900">{invoice.vendor?.name || invoice.sellerName || "Chưa xác định"}</p><p className="mt-1 text-xs text-gray-500">MST: {invoice.vendor?.taxCode || invoice.sellerTaxCode || "—"}</p></td>
        <td className="px-4 py-4"><p className="max-w-56 text-gray-700">{invoice.buyerName || "Chưa đọc được"}</p><p className="mt-1 text-xs text-gray-500">MST: {invoice.buyerTaxCode || "—"}</p></td>
        <td className="whitespace-nowrap px-4 py-4 text-right font-semibold text-gray-900">{formatMoney(invoice.totalAmount, invoice.currency)}</td>
        <td className="px-4 py-4"><StatusBadge invoice={invoice} />{invoice.note && <p className="mt-2 max-w-56 text-xs leading-5 text-gray-500">{invoice.note}</p>}</td>
        <td className="px-4 py-4">{invoice.shipmentCost ? <><Link href={`/costs?shipmentId=${invoice.shipmentCost.shipment.id}`} className="font-medium text-blue-600 hover:underline">TK {invoice.shipmentCost.shipment.declarationNo || "chưa có"}</Link><p className="mt-1 max-w-64 text-xs text-gray-500">{invoice.shipmentCost.shipment.goodsName || invoice.shipmentCost.shipment.customerName}</p><p className="mt-1 text-xs text-gray-400">Chi phí: {formatMoney(invoice.shipmentCost.costPrice)}</p></> : <span className="text-gray-400">Chưa ghép lô hàng</span>}</td>
        <td className="px-4 py-4 text-right"><div className="flex justify-end gap-3">{invoice.pdfUrl && <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">PDF</a>}{invoice.xmlUrl && <a href={invoice.xmlUrl} target="_blank" rel="noreferrer" className="font-medium text-emerald-600 hover:underline">XML</a>}{!invoice.pdfUrl && !invoice.xmlUrl && <a href={invoice.attachmentUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">Mở file</a>}</div></td>
      </tr>)}
    </tbody>
  </table></div>;
}

function PartnerTable({ rows, isLoading }: { rows: PartnerRow[]; isLoading: boolean }) {
  return <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm">
    <thead className="bg-gray-50"><tr><th className="w-16 px-4 py-3 text-center font-medium text-gray-500">STT</th><th className="px-4 py-3 text-left font-medium text-gray-500">Tên đối tác</th><th className="px-4 py-3 text-left font-medium text-gray-500">Mã số thuế</th><th className="px-4 py-3 text-left font-medium text-gray-500">Loại đối tác</th><th className="px-4 py-3 text-right font-medium text-gray-500">Số hóa đơn</th><th className="px-4 py-3 text-right font-medium text-gray-500">Đã khớp</th><th className="px-4 py-3 text-right font-medium text-gray-500">Tổng tiền</th></tr></thead>
    <tbody className="divide-y divide-gray-100">{isLoading && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Đang tải đối tác...</td></tr>}{!isLoading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Chưa có đối tác được nhận diện từ hóa đơn.</td></tr>}{!isLoading && rows.map((partner, index) => <tr key={partner.id} className="hover:bg-gray-50"><td className="px-4 py-3 text-center text-gray-400">{index + 1}</td><td className="px-4 py-3 font-medium text-gray-900">{partner.name}</td><td className="px-4 py-3 text-gray-600">{partner.taxCode || "—"}</td><td className="px-4 py-3 text-gray-600">{partner.type || "—"}</td><td className="px-4 py-3 text-right text-gray-700">{partner.invoiceCount}</td><td className="px-4 py-3 text-right text-emerald-700">{partner.matchedCount}</td><td className="px-4 py-3 text-right font-semibold text-gray-900">{formatMoney(partner.totalAmount)}</td></tr>)}</tbody>
  </table></div>;
}

function Metric({ label, value, note, accent = "default" }: { label: string; value: string; note: string; accent?: "default" | "blue" | "green" | "amber" }) {
  const color = accent === "blue" ? "border-blue-200 bg-blue-50 text-blue-900" : accent === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : accent === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-200 bg-white text-gray-900";
  return <div className={`rounded-xl border p-4 ${color}`}><p className="text-xs opacity-70">{label}</p><p className="mt-1 text-xl font-bold">{value}</p><p className="mt-1 text-xs opacity-60">{note}</p></div>;
}
